import type {
  CSSProperties,
  FocusEventHandler,
  KeyboardEventHandler,
  ReactNode,
  Ref,
} from 'react'
import { createPortal } from 'react-dom'

import { useHoverCard, type HoverCardContent } from './useHoverCard'
import './HoverCard.css'

export type { HoverCardContent, HoverRow } from './useHoverCard'

function mergeRefs<T>(a: Ref<T> | undefined, b: Ref<T> | undefined) {
  return (node: T | null) => {
    for (const ref of [a, b]) {
      if (!ref) continue
      if (typeof ref === 'function') ref(node)
      else (ref as { current: T | null }).current = node
    }
  }
}

/**
 * The card itself -- header, hairline, rows or prose, footnote.
 *
 * `rows` and `prose` are mutually exclusive in practice: a data point carries rows, a
 * designated indicator that only explains a label carries prose instead.
 */
function HoverCardSurface({
  id,
  content,
  cardRef,
}: {
  id: string
  content: HoverCardContent
  cardRef: Ref<HTMLDivElement>
}) {
  return (
    <div className="hover-card" role="tooltip" id={id} ref={cardRef}>
      <p className="hover-card-header">{content.header}</p>
      {content.prose ? (
        <p className="hover-card-prose">{content.prose}</p>
      ) : content.rows && content.rows.length > 0 ? (
        <>
          <div className="hover-card-rule" aria-hidden="true" />
          <dl className="hover-card-rows">
            {content.rows.map((row, index) => (
              <div className="hover-card-row" key={row.name ?? index}>
                <dt>
                  {content.swatch && (
                    <span
                      className="hover-card-swatch"
                      data-level={content.swatch}
                      aria-hidden="true"
                    />
                  )}
                  {row.name}
                </dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : null}
      {content.footnote && <p className="hover-card-footnote">{content.footnote}</p>}
    </div>
  )
}

type HoverTargetTag = 'span' | 'div' | 'th' | 'td'

export interface HoverTargetProps {
  /** What the card says when this target is hovered, focused, clicked or tapped. */
  card: HoverCardContent
  /**
   * The element actually rendered. A closed union, not a generic `ElementType`: every
   * caller of this component is already known, and a polymorphic prop earns nothing here.
   */
  as?: HoverTargetTag
  className?: string
  style?: CSSProperties
  /**
   * Defaults to 0 -- a designated indicator is its own tab stop. A chart mark inside a
   * roving-tabindex group passes 0 or -1 explicitly instead.
   */
  tabIndex?: number
  /** Read by assistive tech whether or not the card happens to be open. */
  'aria-label'?: string
  /** For a roving group to register this target's DOM node and move focus to it. */
  elementRef?: Ref<HTMLElement>
  onFocus?: FocusEventHandler<HTMLElement>
  onKeyDown?: KeyboardEventHandler<HTMLElement>
  children?: ReactNode
  /** Passed straight through to the anchor -- the heatmap's ramp step, the topic ladder's status. */
  [dataAttr: `data-${string}`]: string | number | undefined
}

/**
 * Renders the anchor itself -- never a wrapper around one.
 *
 * ⚠️ Load-bearing. `.heat-cell` is a CSS grid item and `.topic-mark` is absolutely
 * positioned inside `.topic-track`; an extra node around either breaks the layout. Every
 * hover target, chart mark or table indicator, is this one component with a different
 * `as` and a different `card`.
 */
export function HoverTarget({
  card,
  as = 'span',
  className,
  style,
  tabIndex = 0,
  'aria-label': ariaLabel,
  elementRef,
  onFocus,
  onKeyDown,
  children,
  ...dataAttrs
}: HoverTargetProps) {
  const { id, anchorRef, cardRef, state, show, hide, toggle } = useHoverCard()
  const Tag = as as 'span'

  return (
    <>
      <Tag
        {...dataAttrs}
        ref={mergeRefs(anchorRef, elementRef) as Ref<HTMLSpanElement>}
        className={className ? `${className} hover-hint` : 'hover-hint'}
        style={style}
        tabIndex={tabIndex}
        aria-label={ariaLabel}
        aria-describedby={state ? id : undefined}
        onPointerEnter={(event) => {
          if (event.pointerType !== 'touch') show()
        }}
        onPointerLeave={hide}
        onFocus={(event) => {
          show()
          onFocus?.(event)
        }}
        onBlur={hide}
        onClick={(event) => {
          event.stopPropagation()
          toggle()
        }}
        onKeyDown={onKeyDown}
      >
        {children}
      </Tag>
      {state && createPortal(<HoverCardSurface id={id} content={card} cardRef={cardRef} />, document.body)}
    </>
  )
}
