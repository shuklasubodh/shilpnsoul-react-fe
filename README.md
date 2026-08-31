# React + Vite

## Market requirement API contract

The storefront assistant uses the existing `VITE_API_BASE_URL` REST API:

- `POST /market-requirements` (public): accepts `product_requested`, `free_text`, `category`, optional requester fields, and `source`.
- `GET /market-requirements` (admin bearer token): returns requirement records including `id`, `created_at`, and `status`.
- `PUT /market-requirements/:id` (admin bearer token): accepts a new `status`.

The backend should persist these records in a `market_requirements` table and enforce admin authorization on list/update. The separate admin UI is available at `/admin/market-requirements`.

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
