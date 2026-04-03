This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
npm run dev:clean
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

If port `3000` is already in use, prefer:

```bash
npm run dev:clean
```

For production mode, you can also use:

```bash
npm run start:clean
```

To only free the port without starting the app:

```bash
npm run free:3000
```

## Supabase Migrations

This app expects the SQL in `supabase/migrations/` to be applied to the target
Supabase project before features that read or write those tables will work.

If the imports page reports that `imported_transactions` is missing, apply the
pending migration with the Supabase CLI:

```bash
npx supabase db push
```

If you are using the hosted Supabase dashboard instead, run the SQL from
`supabase/migrations/20260401_create_imported_transactions.sql` in the SQL
editor for the same project configured in `.env.local`.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
