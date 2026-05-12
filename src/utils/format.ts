export function formatDuration(totalSeconds?: number): string {
  if (!totalSeconds || totalSeconds < 1) {
    return "live";
  }

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);

  const parts =
    hours > 0
      ? [hours, minutes.toString().padStart(2, "0"), seconds.toString().padStart(2, "0")]
      : [minutes, seconds.toString().padStart(2, "0")];

  return parts.join(":");
}

export function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}
