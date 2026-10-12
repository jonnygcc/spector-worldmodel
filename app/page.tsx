import UrlInput from "@/components/ui/UrlInput";

export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
      <div className="mb-2 text-sm font-medium tracking-widest uppercase text-cyan">
        UX Journey Predictor
      </div>

      <h1 className="font-heading text-5xl font-bold mb-4 leading-tight">
        Predict UX issues<br />
        <span className="text-cyan">before users find them</span>
      </h1>

      <p className="text-gray-text max-w-xl mb-10 text-lg">
        Paste any URL and Spector will simulate user journeys using AI,
        detecting friction points and usability problems automatically.
      </p>

      <UrlInput />
    </div>
  );
}