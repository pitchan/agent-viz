/**
 * Premier et dernier horodatage d'une session — la seule source de la durée.
 * Comparaison par époque parsée : on ne suppose pas que les lignes du
 * transcript sont chronologiques. Un horodatage illisible est ignoré (le reste
 * de la session reste mesurable) ; la chaîne d'origine est restituée telle
 * quelle, jamais reformatée.
 */
export class SessionClock {
  private firstIso: string | null = null;
  private firstMs = Number.POSITIVE_INFINITY;
  private lastIso: string | null = null;
  private lastMs = Number.NEGATIVE_INFINITY;

  add(timestamp: string | undefined): void {
    if (timestamp === undefined) return;
    const ms = Date.parse(timestamp);
    if (Number.isNaN(ms)) return;
    if (ms < this.firstMs) {
      this.firstMs = ms;
      this.firstIso = timestamp;
    }
    if (ms > this.lastMs) {
      this.lastMs = ms;
      this.lastIso = timestamp;
    }
  }

  first(): string | null {
    return this.firstIso;
  }

  last(): string | null {
    return this.lastIso;
  }
}
