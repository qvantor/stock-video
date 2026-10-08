import { useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { isVideoSettled } from '@dfs/contracts';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { formatDuration } from '../lib/format';
import { reviewQueue } from '../lib/review';
import { useDeleteProject, useProject, useReopenProject } from '../api/projects';
import { useProjectSummary } from '../api/segments';
import { useDeleteVideo, useRetryVideo, useSetVideoReviewed, useVideos } from '../api/videos';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DuplicateUploadDialog } from '../components/DuplicateUploadDialog';
import { LocalUploads } from '../components/LocalUploads';
import { SettingsPanel } from '../components/SettingsPanel';
import { VideoCard } from '../components/VideoCard';
import { useProjectEvents } from '../hooks/useProjectEvents';
import { useUploadStore } from '../uploads/uploadStore';

const ACCEPT = { 'video/mp4': ['.mp4'], 'video/quicktime': ['.mov'] };

export const ProjectPage = () => {
  const { projectId = '' } = useParams();
  useProjectEvents(projectId);
  const { data: project, error } = useProject(projectId);
  const { data: videos } = useVideos(projectId);
  const { data: summary } = useProjectSummary(projectId);
  const retry = useRetryVideo(projectId);
  const remove = useDeleteVideo(projectId);
  const setReviewed = useSetVideoReviewed(projectId);
  const addFiles = useUploadStore((s) => s.addFiles);
  const cancelUploads = useUploadStore((s) => s.cancelProject);
  const deleteProject = useDeleteProject(projectId);
  const reopen = useReopenProject(projectId);
  const navigate = useNavigate();

  const onDeleteProject = () => {
    if (!project) return;
    const count = videos?.length ?? 0;
    const ok = window.confirm(
      `Delete project “${project.name}”?\n\n` +
        `This permanently removes ${count} video${count === 1 ? '' : 's'} (original files, proxies, ` +
        `thumbnails, analysis data), all segments` +
        `${project.manifestPath ? ' and manifest.json' : ''}. This cannot be undone.`,
    );
    if (!ok) return;
    cancelUploads(projectId);
    deleteProject.mutate(undefined, { onSuccess: () => navigate('/', { replace: true }) });
  };
  const onReopen = () => {
    const ok = window.confirm(
      'Reopen the project for editing?\n\n' +
        'All export results (clips, metadata, approvals, exclusions, archive) will be deleted. ' +
        'Everything is regenerated from scratch after you confirm the segments again.',
    );
    if (ok) reopen.mutate();
  };
  const readOnly = project?.status === 'confirmed';
  const [confirming, setConfirming] = useState(false);
  // Button is active once everything is processed and something is accepted;
  // validation problems are shown (and block) inside the dialog.
  const canOpenConfirm =
    !readOnly &&
    !!summary &&
    !!videos &&
    videos.length > 0 &&
    videos.every((v) => isVideoSettled(v.status)) &&
    summary.acceptedSegments > 0;
  const toReview = reviewQueue(videos ?? []);
  const hasReady = !!videos?.some((v) => v.status === 'ready');

  const { getRootProps, getInputProps, isDragActive, open, fileRejections } = useDropzone({
    accept: ACCEPT,
    noClick: true,
    noKeyboard: true,
    disabled: !project || readOnly,
    onDropAccepted: (files) => addFiles(projectId, files),
  });

  if (error) return <div className="p-8 text-red-400">{error.message}</div>;
  if (!project) return <div className="p-8 text-neutral-500">Loading…</div>;

  return (
    <>
      <div {...getRootProps({ className: 'relative min-h-full outline-none' })}>
        <input {...getInputProps()} />
        {isDragActive && (
          <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center border-4 border-dashed border-sky-500 bg-sky-950/70">
            <div className="text-2xl font-medium text-sky-200">Drop to upload videos</div>
          </div>
        )}

        <header className="sticky top-0 z-10 flex items-center gap-4 border-b border-neutral-800 bg-neutral-950/90 px-6 py-3 backdrop-blur">
          <Link to="/" className="text-neutral-400 hover:text-neutral-100">
            ← Projects
          </Link>
          <h1 className="flex-1 truncate text-lg font-semibold text-neutral-100">{project.name}</h1>
          {readOnly ? (
            <>
              <span className="rounded bg-emerald-900/60 px-2 py-1 text-sm text-emerald-300">
                Confirmed
              </span>
              <button
                onClick={onReopen}
                disabled={reopen.isPending}
                title="Edit segments again and re-confirm (regenerates the export)"
                className="rounded-md bg-neutral-800 px-3 py-1.5 text-sm hover:bg-neutral-700 disabled:opacity-40"
              >
                {reopen.isPending ? 'Reopening…' : 'Reopen'}
              </button>
              <Link
                to="export"
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
              >
                Export →
              </Link>
            </>
          ) : (
            <>
              <button
                onClick={open}
                className="rounded-md bg-neutral-800 px-3 py-1.5 text-sm hover:bg-neutral-700"
              >
                + Add videos
              </button>
              <button
                onClick={() => navigate(`videos/${toReview[0].id}`)}
                disabled={toReview.length === 0}
                title={
                  toReview.length > 0
                    ? undefined
                    : hasReady
                      ? 'All videos are checked'
                      : 'No videos ready yet'
                }
                className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-40"
              >
                Review segments{toReview.length > 0 && ` (${toReview.length} left)`}
              </button>
              <button
                onClick={() => setConfirming(true)}
                disabled={!canOpenConfirm}
                title={canOpenConfirm ? undefined : summary?.blockers.join('\n')}
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
              >
                Confirm segments
              </button>
            </>
          )}
          <button
            onClick={onDeleteProject}
            disabled={deleteProject.isPending}
            className="rounded-md border border-red-900 px-3 py-1.5 text-sm text-red-300 hover:bg-red-950 disabled:opacity-40"
          >
            {deleteProject.isPending ? 'Deleting…' : 'Delete project'}
          </button>
        </header>
        {reopen.error && (
          <p className="px-6 pt-3 text-sm text-red-400">
            Failed to reopen the project: {reopen.error.message}
          </p>
        )}
        {deleteProject.error && (
          <p className="px-6 pt-3 text-sm text-red-400">
            Failed to delete the project: {deleteProject.error.message}
          </p>
        )}

        <div className="mx-auto grid max-w-6xl gap-6 p-6 lg:grid-cols-[1fr_300px]">
          <main>
            {readOnly && project.manifestPath && (
              <div className="mb-4 rounded-lg border border-emerald-800 bg-emerald-950/40 p-4 text-sm">
                Segments confirmed. Manifest:{' '}
                <code className="select-all text-emerald-300">{project.manifestPath}</code>
              </div>
            )}
            {fileRejections.length > 0 && (
              <p className="mb-3 text-sm text-amber-400">
                Skipped files: {fileRejections.length} (only MP4 and MOV are supported)
              </p>
            )}
            <LocalUploads projectId={projectId} />
            <DuplicateUploadDialog projectId={projectId} projectName={project.name} />
            {videos && videos.length === 0 ? (
              <button
                onClick={open}
                disabled={readOnly}
                className="flex h-72 w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-neutral-700 text-neutral-400 hover:border-sky-600 hover:text-neutral-200"
              >
                <span className="text-lg">Drop videos here</span>
                <span className="text-sm text-neutral-500">MP4 / MOV, several files at once</span>
              </button>
            ) : (
              <ul className="space-y-2">
                {videos?.map((v) => (
                  <VideoCard
                    key={v.id}
                    video={v}
                    readOnly={readOnly}
                    onRetry={() => retry.mutate(v.id)}
                    onDelete={() => remove.mutate(v.id)}
                    onUncheck={() => setReviewed.mutate({ videoId: v.id, reviewed: false })}
                  />
                ))}
              </ul>
            )}
          </main>

          <aside className="space-y-4">
            <SettingsPanel project={project} />
            <section className="rounded-lg border border-neutral-800 p-4">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-400">
                Summary
              </h2>
              {summary ? (
                <dl className="tabular grid grid-cols-[1fr_auto] gap-y-1 text-sm">
                  <dt className="text-neutral-400">Videos</dt>
                  <dd>
                    {summary.readyCount}/{summary.videoCount} ready
                  </dd>
                  <dt className="text-neutral-400">Proposed segments</dt>
                  <dd>{summary.proposedSegments}</dd>
                  <dt className="text-neutral-400">Accepted</dt>
                  <dd>{summary.acceptedSegments}</dd>
                  <dt className="text-neutral-400">Total duration</dt>
                  <dd>{formatDuration(summary.acceptedDurationSec)}</dd>
                  {summary.issueCount > 0 && (
                    <>
                      <dt className="text-amber-400">Warnings</dt>
                      <dd className="text-amber-400">{summary.issueCount}</dd>
                    </>
                  )}
                </dl>
              ) : (
                <p className="text-sm text-neutral-500">—</p>
              )}
            </section>
          </aside>
        </div>
      </div>
      {confirming && summary && (
        <ConfirmDialog
          projectId={projectId}
          summary={summary}
          onClose={() => setConfirming(false)}
        />
      )}
    </>
  );
};
