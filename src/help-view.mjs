import { html } from './work-views.mjs';
const time = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleTimeString() : 'Not recorded';
const count = value => Array.isArray(value)?value.length:typeof value==='number'?value:'Not reported';
const interval = value => typeof value==='number'?`${value/1000} s`:'Not reported';
export function backgroundStatusMarkup(state,receivedAt) {
  const coordinator=state.coordinator || {},loop=coordinator.loop || {},focus=coordinator.focus || {};
  const background=state.background || {};
  const rows=[
    ['Local service',`${background.service?.state || 'Not reported'}${background.service?.survivesQuit===false?' · stops when the app quits':''}`],
    ['Collection loop',`${background.collection?.state || 'Not reported'} · interval ${interval(background.collection?.intervalMs)} · last check ${time(background.collection?.lastCheckedAt)}${background.collection?.running?' · collecting now':''}`],
    ['Local discovery',`${background.localDiscovery?.mode || 'Not reported'} · cache ${interval(background.localDiscovery?.cacheMs)} · last ${time(background.localDiscovery?.lastCollectedAt)}`],
    ['Remote discovery',`${background.remoteDiscovery?.state || 'Not reported'} · interval ${interval(background.remoteDiscovery?.intervalMs)} · history cache ${interval(background.remoteDiscovery?.historyCacheMs)}`],
    ['Interface refresh',interval(background.interface?.intervalMs)],
    ['Notifications',`${background.notifications?.enabled===true?'Enabled':background.notifications?.enabled===false?'Disabled':'Not reported'} · watcher ${interval(background.notifications?.intervalMs)}`],
    ['Terminal output',`${background.terminal?.mode || 'Not reported'} · ${count(background.terminal?.attachments)} attachments`],
    ['Agent browsers',`${background.browser?.mode || 'Not reported'} · ${count(background.browser?.contexts)} contexts`]
  ];
  return `<h2>Live background status</h2><dl class="docs-status-grid"><dt>Conductor loop</dt><dd>${html(loop.state || 'Unavailable')}${coordinator.running?' · decision in progress':''}</dd><dt>Collection</dt><dd>Last observed ${html(time(loop.lastCollectedAt))}</dd><dt>Model decisions</dt><dd>Last ${html(time(loop.lastRoundAt))} · next ${html(loop.nextRoundAt?time(loop.nextRoundAt):'none scheduled')}</dd><dt>Progress observations</dt><dd>${html(count(loop.observedProgress))} observed · ${html(count(loop.pendingProgress))} awaiting review</dd><dt>Conductor context</dt><dd>${html(focus.summary || (focus.projectId?'Project selected':'No focused project recorded'))}</dd><dt>Interface state</dt><dd>Received ${html(time(receivedAt))}</dd></dl>${loop.lastError?`<p class="problem-note">${html(loop.lastError)}</p>`:''}<details class="docs-sources"><summary>Service, discovery and refresh details</summary><dl class="docs-status-grid">${rows.map(([label,value])=>`<dt>${html(label)}</dt><dd>${html(value)}</dd>`).join('')}</dl>${background.collection?.lastError?`<p class="problem-note">${html(background.collection.lastError)}</p>`:''}</details>${(state.remote || []).length?`<details class="docs-sources"><summary>Environment scan status</summary>${state.remote.map(source=>`<p><strong>${html(state.hostNames?.[source.host] || source.host)}</strong> · ${html(source.error?'Unavailable: '+source.error:source.scanning?'Scan in progress':source.scannedAt?'Last observed '+time(source.scannedAt):'Not scanned')}</p>`).join('')}</details>`:'<p class="work-hint">No remote scan status reported. A recent interface refresh does not prove every source is fresh.</p>'}`;
}
