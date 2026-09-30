// Mehrere KI-Aufgaben gleichzeitig abarbeiten (begrenzt), statt eine nach der anderen.
// Bei 50 Mails am Morgen liegen die Entwürfe so in Minuten bereit statt in einer halben Stunde.
export async function runPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}
