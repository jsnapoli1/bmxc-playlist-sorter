import { useSpotify } from '../spotify/SpotifyProvider.tsx'

/**
 * Tokens never gain scopes retroactively. When this app starts asking for a
 * permission it did not ask for before, anyone already signed in keeps a
 * token without it — and the calls needing it fail — until they consent
 * again. This offers that in one click, wherever it is noticed.
 */
export default function ScopeNotice() {
  const { missingScopes, reconnect } = useSpotify()
  if (!missingScopes.length) return null

  return (
    <div className="banner error tiny">
      <strong>Spotify needs re-authorising.</strong> This sign-in predates a permission the app
      now needs ({missingScopes.join(', ')}), and Spotify cannot add it to an existing sign-in.
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn sm primary" onClick={() => void reconnect()}>
          Reconnect Spotify
        </button>
      </div>
    </div>
  )
}
