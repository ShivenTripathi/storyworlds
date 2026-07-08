export default function ShelfPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center py-24 text-center">
      <p className="eyebrow mb-6">YOUR SHELF</p>
      <h1 className="font-display max-w-xl text-4xl leading-tight sm:text-5xl">
        The shelf awaits its first book.
      </h1>
      <p className="font-ui mt-6 max-w-md text-base opacity-70">
        Upload a book to begin — the world inside it will follow.
      </p>
      <button
        type="button"
        disabled
        className="font-ui mt-10 cursor-not-allowed rounded-full border border-[var(--border,rgba(128,128,128,0.3))] px-6 py-3 text-sm font-medium opacity-50"
      >
        Add a book
      </button>
    </div>
  );
}
