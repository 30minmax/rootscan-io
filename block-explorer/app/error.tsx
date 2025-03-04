"use client" // Error components must be Client Components

import { Button } from "@/components/ui/button"
import Link from "next/link"
import { useEffect } from "react"

export default function Error({
  error,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error(error)
  }, [error])

  return (
    <div className="grid min-h-[50vh] place-items-center py-10">
      <div className="flex flex-col items-center gap-4">
        <div className="text-6xl font-bold">Oops...</div>
        <div className="text-xl font-bold text-muted-foreground">
          Something went wrong.
        </div>
        <p className="whitespace-pre-line text-red-500">{error?.message}</p>
        <Link href="/">
          <Button>Back to Home</Button>
        </Link>
      </div>
    </div>
  )
}
