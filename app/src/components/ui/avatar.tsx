import * as React from "react"

export interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> { }

const Avatar = React.forwardRef<HTMLDivElement, AvatarProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={`relative inline-flex h-10 w-10 shrink-0 overflow-hidden rounded-full bg-gray-100 ${className}`}
      {...props}
    />
  )
)
Avatar.displayName = "Avatar"

export interface AvatarImageProps
  extends React.ImgHTMLAttributes<HTMLImageElement> { }

const AvatarImage = React.forwardRef<HTMLImageElement, AvatarImageProps>(
  (props, ref) => {
    const [hasError, setHasError] = React.useState(false)
    const [loaded, setLoaded] = React.useState(false)

    React.useEffect(() => {
      setHasError(false)
      setLoaded(false)
    }, [props.src])

    if (hasError || !props.src) return null

    return (
      // eslint-disable-next-line jsx-a11y/alt-text, @next/next/no-img-element
      <img
        ref={ref}
        className={`aspect-square h-full w-full object-cover ${loaded ? '' : 'invisible absolute'}`}
        onLoad={() => setLoaded(true)}
        onError={() => setHasError(true)}
        {...props}
      />
    )
  }
)
AvatarImage.displayName = "AvatarImage"

export interface AvatarFallbackProps
  extends React.HTMLAttributes<HTMLDivElement> { }

const AvatarFallback = React.forwardRef<HTMLDivElement, AvatarFallbackProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={`flex h-full w-full items-center justify-center bg-gray-200 font-medium text-gray-700 ${className}`}
      {...props}
    />
  )
)
AvatarFallback.displayName = "AvatarFallback"

export { Avatar, AvatarImage, AvatarFallback }
