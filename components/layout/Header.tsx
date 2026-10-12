export default function Header() {
  return (
    <header className="border-b border-dark-border px-6 py-4">
      <div className="max-w-6xl mx-auto flex items-center justify-between">
        <h1 className="font-heading text-xl font-bold tracking-tight">
          Spector
        </h1>
        <span className="text-sm text-gray-text">UX Journey Predictor</span>
      </div>
    </header>
  );
}