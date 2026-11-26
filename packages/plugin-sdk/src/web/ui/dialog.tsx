import * as React from "react"
import { cn } from "../lib/utils"
import { XIcon } from "lucide-react"
import { Dialog as DialogPrimitive } from "radix-ui"

import { Button } from "./button"

/**
 * Dialog (design-system Dialog): title + text + list / form + buttons, cancel on the left, the main action on the right.
 * Forms and pickers are plain dialogs that a stray click outside does NOT close (E-07); Esc still does.
 * Pass `dismissOnOutside` to opt back into closing on an outside click. `size="wide"` is the 560 px form width.
 */
function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-material-scrim data-[state=open]:animate-[bb-fade_var(--duration-fade)_var(--ease-out)_both] data-[state=closed]:animate-[bb-fade-out_var(--duration-fade)_var(--ease-out)_both]",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = false,
  dismissOnOutside = false,
  size = "default",
  onPointerDownOutside,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
  dismissOnOutside?: boolean
  size?: "default" | "wide"
}) {
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        data-size={size}
        onPointerDownOutside={e => {
          onPointerDownOutside?.(e)
          if (!dismissOnOutside) e.preventDefault()
        }}
        className={cn(
          "fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100%-32px)] w-[min(440px,calc(100%-32px))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl bg-surface-raised p-5 text-ink-1 shadow-dialog outline-none data-[size=wide]:w-[min(560px,calc(100%-32px))] data-[state=open]:animate-[bb-dialog_var(--duration-settle)_var(--spring-settle)_both] data-[state=closed]:animate-[bb-fade-out_var(--duration-fade)_var(--ease-out)_both]",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="absolute top-4 right-4 grid size-7 place-items-center rounded-sm text-ink-2 outline-none hover:bg-fill-rest hover:text-ink-1 focus-visible:outline-2 focus-visible:outline-accent-ring [&_svg]:size-4"
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col text-left", className)}
      {...props}
    />
  )
}

/** The dialog's middle part (list, form); scrolls when tall. */
function DialogBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-body"
      className={cn("mt-4 min-h-0 overflow-auto", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "mt-6 flex items-center justify-end gap-2",
        className
      )}
      {...props}
    >
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="ghost" size="lg">Close</Button>
        </DialogPrimitive.Close>
      )}
      {children}
    </div>
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("m-0 text-[15px] leading-5 font-semibold tracking-[-0.01em] text-ink-1", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("mt-1.5 text-ink-2", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
