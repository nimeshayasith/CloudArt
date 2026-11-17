import { useEffect, useRef, useState } from 'react'
import { loadYouTubeApi, youtubeWatchUrl } from '../lib/youtube'

const REPORT_EVERY_MS = 15_000

/**
 * One YouTube video. It starts at `startSeconds` and calls `onProgress({ position, duration })`
 * every 15 s while playing, on pause, on end and when it is removed, so the caller can save progress.
 * The caller should give it `key={lessonId}` so each lesson gets a fresh player.
 */
export default function YouTubePlayer({ videoId, startSeconds = 0, title, onProgress, onEnded }) {
  const hostRef = useRef(null)
  const playerRef = useRef(null)
  const callbacks = useRef({})
  // Fixed for the life of this player: a new lesson gets a new player (the parent sets key={lessonId}).
  const [first] = useState(() => ({ videoId, startSeconds }))
  const [status, setStatus] = useState('loading')

  useEffect(() => {
    callbacks.current = { onProgress, onEnded }
  })

  useEffect(() => {
    let cancelled = false
    let timer = null

    const report = () => {
      const player = playerRef.current
      if (!player?.getCurrentTime) return
      const position = Number(player.getCurrentTime()) || 0
      const duration = Number(player.getDuration?.()) || 0
      callbacks.current.onProgress?.({ position, duration })
    }

    loadYouTubeApi()
      .then((YT) => {
        if (cancelled || !hostRef.current) return
        const mount = document.createElement('div')
        hostRef.current.appendChild(mount)
        playerRef.current = new YT.Player(mount, {
          host: 'https://www.youtube-nocookie.com',
          videoId: first.videoId,
          width: '100%',
          height: '100%',
          playerVars: { start: Math.floor(first.startSeconds), rel: 0, modestbranding: 1, playsinline: 1 },
          events: {
            onReady: () => !cancelled && setStatus('ready'),
            onError: () => !cancelled && setStatus('error'),
            onStateChange: (e) => {
              clearInterval(timer)
              if (e.data === YT.PlayerState.PLAYING) {
                timer = setInterval(report, REPORT_EVERY_MS)
              } else if (e.data === YT.PlayerState.PAUSED) {
                report()
              } else if (e.data === YT.PlayerState.ENDED) {
                report()
                callbacks.current.onEnded?.()
              }
            },
          },
        })
      })
      .catch(() => !cancelled && setStatus('error'))

    return () => {
      cancelled = true
      clearInterval(timer)
      report() // save where the student left off when they switch lessons or leave the page
      try { playerRef.current?.destroy?.() } catch { /* the iframe is already gone */ }
      playerRef.current = null
    }
  }, [first])

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-white/10 bg-black">
      <div ref={hostRef} className="absolute inset-0 [&>iframe]:h-full [&>iframe]:w-full" aria-label={title ? `Video: ${title}` : 'Video player'} />
      {status === 'loading' && <p role="status" className="absolute inset-0 grid place-items-center text-sm text-ca-muted font-mono pointer-events-none">Loading video…</p>}
      {status === 'error' && (
        <div role="alert" className="absolute inset-0 grid place-items-center p-4 text-center text-sm text-red-300 bg-ca-bg2/95">
          <p>
            The video couldn’t be played here.{' '}
            <a href={youtubeWatchUrl(first.videoId)} target="_blank" rel="noreferrer noopener" className="underline text-ca-gold">Watch it on YouTube</a>
          </p>
        </div>
      )}
    </div>
  )
}
