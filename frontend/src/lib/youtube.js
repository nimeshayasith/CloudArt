let apiPromise = null

/** Loads YouTube's IFrame Player API once and resolves with `window.YT`. */
export function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  if (!apiPromise) {
    apiPromise = new Promise((resolve, reject) => {
      const previous = window.onYouTubeIframeAPIReady
      window.onYouTubeIframeAPIReady = () => {
        previous?.()
        resolve(window.YT)
      }
      const tag = document.createElement('script')
      tag.src = 'https://www.youtube.com/iframe_api'
      tag.async = true
      tag.onerror = () => {
        apiPromise = null
        tag.remove()
        reject(new Error('The video player could not be loaded'))
      }
      document.head.appendChild(tag)
    })
  }
  return apiPromise
}

export const youtubeWatchUrl = (videoId) => `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`
