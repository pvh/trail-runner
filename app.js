// And henceforth, we can load React! JSX still TBD.
const React = await import("react")
const { useState, useCallback, useEffect } = React
const client = await import("react-dom/client")
const { useDocument, RepoContext } = await import("@automerge/automerge-repo-react-hooks")
const { html } = await import("htm/react")
//const repo = await import("repo")
const { createRoot } = client
const ReactJson = await import("react-json-view")

// Clear the existing HTML content
document.body.innerHTML = '<div id="app"></div>'

// Render your React component instead
const root = createRoot(document.getElementById("app"))
root.render(
  React.createElement(RepoContext.Provider, { value: repo }, React.createElement(Root, {}))
)

function Root() {
  const documentId = new URL(location.href).searchParams.get("documentId")

  return html`
    <div>
      <h1>Hello react!</h1>
      <${RawView} documentId=${documentId} />
    </div>
  `
}

function RawView(props) {
  const [doc, changeDoc] = useDocument(props.documentId)
  const [isMetaPressed, setIsAltPressed] = useState(false)

  const onEdit = useCallback(
    ({ namespace, new_value, name }) => {
      changeDoc((doc) => {
        let current = doc

        for (const key of namespace) {
          current = current[key]
        }

        current[name] = new_value
      })
    },
    [changeDoc]
  )

  const onAdd = useCallback(() => true, [])
  const onDelete = useCallback(
    ({ namespace, name }) => {
      changeDoc((doc) => {
        let current = doc

        for (const key of namespace) {
          current = current[key]
        }

        delete current[name]
      })
    },
    [changeDoc]
  )

  const onSelect = useCallback(
    ({ value }) => {
      // todo: add back
      /*if (!(typeof value === "string")) {
        return
      }

      if (isPushpinUrl(value)) {
        openDocument(
          isMetaPressed ? createDocumentLink("raw", parseDocumentLink(value).documentId) : value
        )
      } else if (isDocumentId(value)) {
        openDocument(createDocumentLink("raw", value))
      }*/
    },
    [changeDoc]
  )

  useEffect(() => {
    const onKeyDown = (evt) => {
      setIsAltPressed(evt.altKey)
    }
    const onKeyUp = (evt) => {
      setIsAltPressed(evt.altKey)
    }

    document.addEventListener("keydown", onKeyDown, true)
    document.addEventListener("keyup", onKeyUp, true)

    return () => {
      document.removeEventListener("keydown", onKeyDown, true)
      document.removeEventListener("keyup", onKeyUp, true)
    }
  }, [setIsAltPressed])

  if (!doc) {
    console.log("not loaded")

    return null
  }

  return React.createElement(ReactJson.default.default, {
    src: doc,
    onEdit,
    onAdd,
    onDelete,
    onSelect,
  })
}
