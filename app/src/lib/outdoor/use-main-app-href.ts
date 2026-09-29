'use client'

import { useEffect, useState } from 'react'
import { mainAppHref } from '@/lib/outdoor/desk'

/** Main-admin link that still works when the page is opened on the Outdoor host. */
export function useMainAppHref(path: string) {
  const [href, setHref] = useState(path)
  useEffect(() => {
    setHref(mainAppHref(path, window.location))
  }, [path])
  return href
}
