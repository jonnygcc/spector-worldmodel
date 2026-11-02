This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Tokens de diseño

Los tokens viven en `app/globals.css`, dentro de `@theme` (Tailwind v4), y copian una a una las variables del documento de Paper "Spector | World Model": mismo nombre, mismo valor. Si cambias un valor, cámbialo primero en Paper.

### La escala de spacing sobrescribe la de Tailwind

Por defecto, en Tailwind v4 `p-24` vale `24 × 0.25rem = 96px`. Aquí no: `--spacing-24` está definido en el tema, y Tailwind usa el valor del tema antes que el multiplicador.

| Clase | Con los tokens de Spector | Tailwind por defecto |
|---|---|---|
| `p-4` | 4px | 16px |
| `gap-8` | 8px | 32px |
| `p-24` | 24px | 96px |
| `mt-96` | 96px | 384px |

Los valores definidos son 4, 8, 12, 16, 24, 32, 48, 64, 96 y 140. Cualquier otro número sigue usando el multiplicador de Tailwind (`p-6` = 24px, `p-20` = 80px), así que usa solo los de la escala.

### Cifras tabulares

Regla del sistema: toda cifra que se lee en columna o se compara con otra (tiempo, probabilidad, pasos, fricción, conteos, horas) lleva la clase `tabular-nums` (`font-variant-numeric: tabular-nums`). Sin ella, los dígitos de Space Grotesk tienen anchos distintos y las columnas de la tabla del reporte se desalinean. La utilidad la trae Tailwind v4; no hay que definirla.

### Tipografía

Space Grotesk (400, 500, 600) se carga en `app/layout.tsx` con `next/font`, self-hosted, y expone la variable `--font-space-grotesk`. Los tokens `--font-heading` y `--font-body` apuntan a ella (`var(--font-space-grotesk), sans-serif`); no uses el nombre literal "Space Grotesk", porque `next/font` renombra la familia al cargarla.

### Interlineado

Paper solo acepta porcentajes, así que allí los `leading-*` están como 115%, 125% y 150%. En `globals.css` se escriben como 1.15, 1.25 y 1.5: un número sin unidad lo recalcula cada elemento según su tamaño, mientras que un porcentaje se convierte en píxeles fijos y los hijos heredan ese valor.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
