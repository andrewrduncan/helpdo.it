/** Stub for routes whose backend resolvers aren't built yet. */
export default function Placeholder({ title, blurb }: { title: string; blurb: string }) {
  return (
    <div className="placeholder">
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      <p>{blurb}</p>
      <small>Coming soon — pending its GraphQL resolvers on the API.</small>
    </div>
  )
}
