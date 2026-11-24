import { get, post, upload } from './api';
import { CORPUS_CHANGED } from './corpus.svelte';
import { t } from './i18n';
import { trackJobs } from './jobs.svelte';
import { messages } from './messages.svelte';
import type { Job, JobReport } from './types';

const POLL_MS = 700;

export interface AnalysisRequest {
  corpusId: number;
  form: FormData;
  params: Record<string, string | number | boolean>;
  /** What is analysed: the file name, or '' for pasted text (shown above the report). */
  source: string;
}

/**
 * The Job analysis, owned here rather than by the Job screen so that the report on screen
 * and an analysis still running survive leaving the screen (a word link to the concordance,
 * the rail). The poll stops only on a new analysis, `reset()` and `corpus-changed`.
 */
class Analysis {
  /** A submitted analysis is queued or running. */
  busy = $state(false);
  /** The last poll of the running job (null until it is past the queue). */
  job = $state.raw<Job | null>(null);
  error = $state('');
  /** The report on screen (kept while a new analysis runs or fails) and the job it came from. */
  report = $state.raw<JobReport | null>(null);
  reportJob = $state(0);
  /** What the report on screen was made from: a file name, or '' for pasted text. */
  source = $state('');
  /** The pasted text, kept with the report. */
  text = $state('');
  /** Where the report on screen is served from (a finished job, or a saved report), for its downloads. */
  resultPath = $state('');
  /** The saved report on screen (opened, or just saved from this analysis), and its title. */
  savedId = $state<number | null>(null);
  title = $state('');
  hasText = $state(false);
  /** Changes whenever another report is put on screen. */
  version = $state(0);

  #seq = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;

  #cancel(): void {
    this.#seq++;
    clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  /** Sleeps one poll interval; the timer is cleared by #cancel() (the promise then never settles). */
  #sleep(): Promise<void> {
    return new Promise<void>((r) => (this.#timer = setTimeout(r, POLL_MS)));
  }

  async start(req: AnalysisRequest): Promise<void> {
    this.#cancel();
    const n = this.#seq;
    this.busy = true;
    this.error = '';
    this.job = null;
    messages.clear();
    try {
      const { job_id } = await upload<{ job_id: number }>(
        `/api/corpora/${req.corpusId}/analyse-job`,
        req.form,
        req.params,
      );
      if (n !== this.#seq) return;
      trackJobs(req.corpusId, true); // the status line counts it like any background job
      let retried = false;
      for (;;) {
        let j: Job;
        try {
          j = await get<Job>(`/api/jobs/${job_id}`);
        } catch (err) {
          if (n !== this.#seq) return;
          // One retry before giving up: a single failed poll is often a blip.
          if (retried) throw err;
          retried = true;
          await this.#sleep();
          if (n !== this.#seq) return;
          continue;
        }
        if (n !== this.#seq) return;
        retried = false;
        if (j.status === 'error') throw new Error(j.error || t('job.analysisFailed'));
        if (j.status === 'done') break;
        this.job = j;
        await this.#sleep();
        if (n !== this.#seq) return;
      }
      const r = await get<JobReport>(`/api/jobs/${job_id}/result`);
      if (n !== this.#seq) return;
      this.report = r;
      this.reportJob = job_id;
      this.resultPath = `/api/jobs/${job_id}/result`;
      this.source = req.source;
      this.savedId = null;
      this.title = '';
      this.hasText = false;
      this.version++;
      this.job = null;
    } catch (err) {
      if (n !== this.#seq) return;
      const message = err instanceof Error ? err.message : String(err);
      this.error = message;
      this.job = null;
      messages.say(message, 'err');
    } finally {
      if (n === this.#seq) this.busy = false;
    }
  }

  /** Keeps the report on screen (a finished analysis) so it can be reopened after a restart. */
  async save(title: string): Promise<number> {
    const { id } = await post<{ id: number }>(`/api/jobs/${this.reportJob}/save`, { title });
    this.savedId = id;
    this.resultPath = `/api/reports/${id}/result`;
    return id;
  }

  /** Puts a saved report on screen. */
  async openSaved(id: number): Promise<void> {
    this.#cancel();
    this.busy = false;
    this.job = null;
    this.error = '';
    const r = await get<JobReport>(`/api/reports/${id}/result`);
    this.report = r;
    this.reportJob = 0;
    this.resultPath = `/api/reports/${id}/result`;
    this.source = (r as JobReport & { source?: string }).source ?? '';
    this.savedId = id;
    this.title = r.title ?? '';
    this.hasText = !!r.has_text;
    this.version++;
  }

  /** Stops any poll and drops the report (the corpus changed; tests). The pasted text stays. */
  reset(): void {
    this.#cancel();
    this.busy = false;
    this.job = null;
    this.error = '';
    this.report = null;
    this.reportJob = 0;
    this.resultPath = '';
    this.savedId = null;
    this.title = '';
    this.hasText = false;
    this.source = '';
    this.version++;
  }
}

export const analysis = new Analysis();

if (typeof window !== 'undefined') {
  window.addEventListener(CORPUS_CHANGED, () => analysis.reset());
}
