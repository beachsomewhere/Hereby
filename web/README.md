This is the [Next.js](https://nextjs.org) app for `hereby.help` - marketing site, privacy policy, and the admin dashboard. See `/Users/kylbarne/.claude/plans/distributed-rolling-snail.md` for the full plan.

## Setup

Create a `.env.local` file in this directory (gitignored) with the same Supabase project credentials as `mobile-app/.env`:

```
NEXT_PUBLIC_SUPABASE_URL=<same value as mobile-app's EXPO_PUBLIC_SUPABASE_URL>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<same value as mobile-app's EXPO_PUBLIC_SUPABASE_ANON_KEY>
```

## Run

```bash
npm run dev
```
