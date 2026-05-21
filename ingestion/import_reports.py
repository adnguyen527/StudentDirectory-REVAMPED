"""
Import anonymized data from Excel files into MongoDB.
DWP rows are parsed at import time — compound string fields are split into
discrete typed fields before insertion.
"""

import re
from pathlib import Path
from datetime import datetime
from pymongo import MongoClient, ASCENDING
from mongo_url import uri
import openpyxl


# ── DWP parsing helpers ───────────────────────────────────────────────────────

def _split(value):
    """'Key: Value;  Key: Value' → dict"""
    if not value:
        return {}
    result = {}
    for part in str(value).split(';  '):
        part = part.strip()
        if ': ' in part:
            key, val = part.split(': ', 1)
            result[key.strip()] = val.strip()
    return result

def _int(value):
    if value is None or str(value).strip() == 'None':
        return None
    try:
        return int(value)
    except (ValueError, TypeError):
        return None

def _bool(value):
    if value is None:
        return None
    return str(value).strip().lower() == 'yes'

def _none(value):
    return None if (value is None or str(value).strip() == 'None') else value

def _to_snake(s):
    return re.sub(r'[^a-z0-9]+', '_', str(s).lower()).strip('_')

def _parse_date(value):
    if not value:
        return None
    try:
        return datetime.strptime(str(value).strip(), '%m/%d/%Y')
    except ValueError:
        return None


def parse_session(value):
    p = _split(value)
    instructors_str = p.get('Instructors', '')
    return {
        'sessions_this_month': _int(p.get('Sessions This Month')),
        'session_start':       p.get('Session Start'),
        'session_end':         p.get('Session End'),
        'instructors':         [i.strip() for i in instructors_str.split(',')] if instructors_str else []
    }

def parse_general_information(value):
    p = _split(value)
    return {
        'session_page_goal': _int(p.get('Session Page Goal')),
        'pages_completed':   _int(p.get('Pages Completed')),
        'mathlete_score':    _int(p.get('Mathlete Score')),
        'last_punch_of_day': _bool(p.get('Last Punch of the Day'))
    }

def parse_digital_reward_system(value):
    p = _split(value)
    stars_str = p.get('Stars on current card', '0')
    if '/' in stars_str:
        left, right = stars_str.split('/', 1)
        stars_current, stars_max = _int(left.strip()), _int(right.strip())
    else:
        stars_current, stars_max = _int(stars_str), None

    session_stars_str = p.get('Session', '0 stars added')
    return {
        'card_level':          _none(p.get('Card level')),
        'stars_current':       stars_current,
        'stars_max':           stars_max,
        'session_stars_added': _int(session_stars_str.split(' ')[0])
    }

def parse_student_materials(value):
    p = _split(value)
    result = {
        'primary_deck_next_page':      _none(p.get('Start page for next session - Primary Deck')),
        'needs_primary_deck_update':   _bool(p.get('Needs Primary Deck update')),
        'secondary_deck_next_page':    _none(p.get('Start page for next session - Secondary Deck')),
        'needs_secondary_deck_update': _bool(p.get('Needs Secondary Deck update')),
        'internet_rating':             _none(p.get('Internet Rating'))
    }
    if 'Problem of the Week' in p:
        result['problem_of_the_week'] = _bool(p['Problem of the Week'])
    return result

def parse_schoolwork(value):
    p = _split(value)
    duration_str = p.get('Duration', '0 min')
    return {
        'schoolwork_start_time':  _none(p.get('Start time')),
        'schoolwork_duration_min': _int(duration_str.split(' ')[0]),
        'schoolwork_completed':   _bool(p.get('Completed')),
        'schoolwork_checked':     _bool(p.get('Checked')),
        'schoolwork_description': _none(p.get('Description'))
    }

def parse_lp_assignment(value):
    if not value:
        return []
    topics = []
    for entry in str(value).split(';  '):
        entry = entry.strip()
        if not entry:
            continue
        match = re.match(r'^([\w-]+)\s+\((.+)\):\s+(.+)$', entry)
        if match:
            topics.append({'id': match.group(1), 'name': match.group(2), 'status': match.group(3).strip()})
        else:
            topics.append({'raw': entry})
    return topics


COMPOUND_FIELDS = ['Session', 'General Information', 'Digital Reward System', 'Student Materials', 'LP Assignment', 'Schoolwork', 'Center']

def parse_center(value):
    if not value:
        return []
    return [c.strip() for c in str(value).split(';  ') if c.strip()]

def transform_dwp_row(row):
    doc = {_to_snake(k): v for k, v in row.items() if k not in COMPOUND_FIELDS}
    doc['date'] = _parse_date(row.get('Date'))
    doc.update(parse_session(row.get('Session')))
    doc.update(parse_general_information(row.get('General Information')))
    doc.update(parse_digital_reward_system(row.get('Digital Reward System')))
    doc.update(parse_student_materials(row.get('Student Materials')))
    doc.update(parse_schoolwork(row.get('Schoolwork')))
    doc['centers'] = parse_center(row.get('Center'))
    doc['topics'] = parse_lp_assignment(row.get('LP Assignment'))
    return doc


# ── Importer ──────────────────────────────────────────────────────────────────

class DataImporter:

    def __init__(self):
        self.client = MongoClient(uri)
        self.db = self.client['StudentDirectory']
        self.stats = {
            'dwp_reports': 0,
            'attendance_reports': 0,
            'enrollment_reports': 0,
            'student_reports': 0,
            'birthday_reports': 0,
            'total_files': 0,
            'total_documents': 0,
            'errors': 0
        }

    def _read_excel(self, path):
        wb = openpyxl.load_workbook(path)
        ws = wb.active
        headers = [cell.value for cell in ws[1]]
        docs = []
        for row in ws.iter_rows(min_row=2, values_only=True):
            if not any(row):
                continue
            docs.append({h: v for h, v in zip(headers, row) if h})
        return docs

    def _collection_name(self, filename):
        name = filename.lower()
        if 'digital workout plan' in name or 'dwp' in name:
            return 'dwp_reports'
        if 'attendance' in name:
            return 'attendance_reports'
        if 'enrollment' in name:
            return 'enrollment_reports'
        if 'birthday' in name:
            return 'birthday_reports'
        if 'student' in name and 'report' in name:
            return 'student_reports'
        return None

    def import_file(self, path):
        filename = Path(path).name
        collection_name = self._collection_name(filename)
        if not collection_name:
            print(f"    ⚠ Unknown file type, skipping: {filename}")
            return

        rows = self._read_excel(path)
        if not rows:
            print(f"    ⚠ No data: {filename}")
            return

        if collection_name == 'dwp_reports':
            rows = [transform_dwp_row(row) for row in rows]

        try:
            result = self.db[collection_name].insert_many(rows)
            count = len(result.inserted_ids)
            print(f"    ✓ {count} → {collection_name}")
            self.stats[collection_name] += count
            self.stats['total_documents'] += count
            if collection_name == 'dwp_reports':
                self.db[collection_name].create_index([('date', ASCENDING)])
                self.db[collection_name].create_index([('account_id', ASCENDING)])
        except Exception as e:
            print(f"    ✗ Insert error: {e}")
            self.stats['errors'] += 1

    def import_all(self, directory='anonymized_data'):
        print(f"\n{'='*60}\nIMPORTING FROM {directory}\n{'='*60}")
        files = sorted(Path(directory).glob('**/*.xlsx'))
        if not files:
            print(f"✗ No Excel files found in {directory}")
            return False

        self.stats['total_files'] = len(files)
        print(f"✓ Found {len(files)} files\n")

        for i, f in enumerate(files, 1):
            print(f"[{i}/{len(files)}] {f.name}")
            try:
                self.import_file(str(f))
            except Exception as e:
                print(f"    ✗ {e}")
                self.stats['errors'] += 1

        return True

    def print_stats(self):
        print(f"\n{'='*60}\nIMPORT COMPLETE\n{'='*60}")
        print(f"Files:     {self.stats['total_files']}")
        print(f"Documents: {self.stats['total_documents']}")
        print(f"Errors:    {self.stats['errors']}")
        print(f"\nBy collection:")
        for name in ['dwp_reports', 'attendance_reports', 'enrollment_reports', 'student_reports', 'birthday_reports']:
            print(f"  {name}: {self.stats[name]}")

    def verify(self):
        print(f"\n{'='*60}\nVERIFICATION\n{'='*60}")
        for name in ['dwp_reports', 'attendance_reports', 'enrollment_reports', 'student_reports', 'birthday_reports']:
            count = self.db[name].count_documents({})
            print(f"  {name}: {count}")

    def close(self):
        self.client.close()


def main():
    importer = DataImporter()
    try:
        importer.db.command('ping')
        print("✓ Connected to MongoDB")
        if importer.import_all('anonymized_data'):
            importer.print_stats()
            importer.verify()
    except Exception as e:
        print(f"✗ {e}")
    finally:
        importer.close()


if __name__ == '__main__':
    main()
