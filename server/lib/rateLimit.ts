import type { Request, Response, NextFunction } from 'express'

interface Window { count: number; resetAt: number }

export function rateLimit(opts: { max: number; windowMs: number; message?: string }) {
  const store = new Map<string, Window>()
  const msg = opts.message ?? 'Too many requests — slow down.'

  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip ?? 'local'
    const now  = Date.now()
    const win  = store.get(key)

    if (!win || now > win.resetAt) {
      store.set(key, { count: 1, resetAt: now + opts.windowMs })
      return next()
    }
    if (win.count >= opts.max) {
      const retryAfter = Math.ceil((win.resetAt - now) / 1000)
      res.setHeader('Retry-After', retryAfter)
      return res.status(429).json({ error: msg, retryAfterSeconds: retryAfter })
    }
    win.count++
    next()
  }
}
