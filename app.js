// And henceforth, we can load React! JSX still TBD.
const React = await import("react")
const client = await import("react-dom/client")
const { createRoot } = client

// Clear the existing HTML content
document.body.innerHTML = '<div id="app"></div>'

// Render your React component instead
const root = createRoot(document.getElementById("app"))
root.render(React.createElement("h1", {}, "Here's React, hosted out of an automerge-repo!"))
