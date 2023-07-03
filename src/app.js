// And henceforth, we can load React! JSX still TBD.
const React = await import("react")
const client = await import("react-dom/client")
const { html } = await import("htm/react")
//const repo = await import("repo")
const { createRoot } = client

// Clear the existing HTML content
document.body.innerHTML = '<div id="app"></div>'

// Render your React component instead
const root = createRoot(document.getElementById("app"))
root.render(React.createElement(Root, {}))

function Root() {
  const documentId = new URL(location.href).searchParams.get("documentId")

  return html`
    <div>
      <h1>Hello react!</h1>
      ${documentId}
    </div>
  `
}
