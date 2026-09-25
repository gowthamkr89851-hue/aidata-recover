import { useState } from 'react'
import { Activity, Archive, BrainCircuit, CheckCircle2, Download, FileText, LoaderCircle, ShieldCheck, UploadCloud } from 'lucide-react'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api'

const demoFiles = [
  'fragment_report_01.bin',
  'fragment_report_02.bin',
  'fragment_report_03.bin',
  'fragment_notes_01.bin',
  'fragment_notes_02.bin',
  'fragment_notes_03.bin',
  'fragment_invoice_01.bin',
  'fragment_invoice_02.bin',
  'fragment_invoice_03.bin'
]

const workflowOrder = ['home', 'upload', 'report']

function App() {
  const [screen, setScreen] = useState('home')
  const [uploadMode, setUploadMode] = useState('fragment')
  const [useAI, setUseAI] = useState(true)
  const [selectedFiles, setSelectedFiles] = useState([])
  const [userDescription, setUserDescription] = useState('')
  const [uploadResult, setUploadResult] = useState(null)
  const [analysisResult, setAnalysisResult] = useState(null)
  const [recoveryResult, setRecoveryResult] = useState(null)
  const [reportText, setReportText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [statusText, setStatusText] = useState('Ready for intake')
  const [processingStage, setProcessingStage] = useState('')
  const [aiReview, setAiReview] = useState(null)
  const [comparison, setComparison] = useState(null)

  function pauseForStage(milliseconds = 5000) {
    return new Promise(resolve => setTimeout(resolve, milliseconds))
  }

  function handleFileSelect(event) {
    const nextFiles = [...event.target.files]
    setSelectedFiles(nextFiles)
    if (nextFiles.length > 1) {
      setUploadMode('fragment')
      setStatusText('Multi-file evidence detected. Using fragment batch mode.')
    }
  }

  async function handleUpload() {
    if (!selectedFiles.length) {
      setError('Select at least one file to continue.')
      return
    }

    const effectiveMode = selectedFiles.length > 1 ? 'fragment' : uploadMode
    setBusy(true)
    setError('')
    setComparison(null)
    setStatusText('Uploading evidence without changing the original...')

    try {
      const formData = new FormData()
      selectedFiles.forEach(file => formData.append('files', file))
      if (userDescription.trim()) formData.append('description', userDescription.trim())
      const response = await fetch(`${API_URL}/upload${effectiveMode === 'fragment' ? '?type=fragment' : ''}`, { method: 'POST', body: formData })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Upload failed')
      setUploadResult(data)
      setAnalysisResult(null)
      setRecoveryResult(null)
      setReportText('')
      setAiReview(null)
      setStatusText(`Uploaded ${data.count} item${data.count > 1 ? 's' : ''}. Starting evidence analysis...`)
      await runAutomaticPipeline(data, effectiveMode)
    } catch (err) {
      setError(err.message)
      setStatusText('Processing failed')
      setProcessingStage('')
    } finally {
      setBusy(false)
    }
  }

  async function runAutomaticPipeline(uploadData, effectiveMode) {
    const records = uploadData.records || []
    const fragmentIds = records.map(item => item.evidenceId || item.fileId).filter(Boolean)
    const isFragmentBatch = uploadData.count > 1 || effectiveMode === 'fragment'

    setProcessingStage('analysis')
    setStatusText('System scan: signatures, metadata, and fragment relationships...')
    const analysisResponse = await fetch(`${API_URL}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(isFragmentBatch ? { fragmentIds } : { fileId: records[0].fileId })
    })
    const nextAnalysis = await analysisResponse.json()
    if (!analysisResponse.ok) throw new Error(nextAnalysis.error || 'Analysis failed')
    setAnalysisResult(nextAnalysis)
    await pauseForStage()

    if (useAI) {
      setProcessingStage('ai')
      setStatusText('AI review: looking for anomalies and missing structure...')
      await pauseForStage()
      const initial = uploadData.initialChecks?.[0] || {}
      const aiResponse = await fetch(`${API_URL}/ai/anomalies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          detectedType: initial.detectedType || nextAnalysis.fileAnalysis?.detectedType || 'UNKNOWN',
          damageStatus: initial.damageStatus || nextAnalysis.fileAnalysis?.damageStatus || 'CORRUPTED',
          structuralIssues: initial.structuralIssues || nextAnalysis.fileAnalysis?.structuralIssues || [],
          byteLength: selectedFiles[0]?.size || 0
        })
      })
      const nextAiReview = await aiResponse.json()
      if (!aiResponse.ok) throw new Error(nextAiReview.error || 'AI review failed')
      setAiReview(nextAiReview)
      await pauseForStage()
    } else {
      setAiReview(null)
    }

    setProcessingStage('recovery')
    setStatusText('Recovery: reconstructing candidates and validating bytes...')
    const recoveryResponse = await fetch(`${API_URL}/recover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(isFragmentBatch ? { fragmentIds, useAI, userDescription } : { fileId: records[0].fileId, useAI, userDescription })
    })
    const nextRecovery = await recoveryResponse.json()
    if (!recoveryResponse.ok) throw new Error(nextRecovery.error || 'Recovery failed')
    setRecoveryResult(nextRecovery)
    await pauseForStage()

    const comparisonResponse = await fetch(`${API_URL}/compare/${nextRecovery.recoveryId}`)
    if (comparisonResponse.ok) setComparison(await comparisonResponse.json())

    setProcessingStage('report')
    setStatusText('Report: packaging provenance, hashes, and validation evidence...')
    const reportResponse = await fetch(`${API_URL}/reports/${nextRecovery.recoveryId}?format=markdown`)
    const nextReport = await reportResponse.text()
    if (!reportResponse.ok) throw new Error('Report generation failed')
    setReportText(nextReport)
    await pauseForStage()
    setStatusText(`Complete: ${nextRecovery.finalClassification}`)
    setProcessingStage('')
    setScreen('report')
  }

  const classification = recoveryResult?.finalClassification || 'AWAITING ANALYSIS'
  const evidenceCount = uploadResult?.count || 0
  const recoveryMetrics = recoveryResult ? {
    system: Number.isFinite(Number(recoveryResult.recoveredPercentage))
      ? Number(recoveryResult.recoveredPercentage)
      : recoveryResult.finalClassification === 'VERIFIED_RECOVERED' && recoveryResult.validation?.score === 100 ? 100 : 0,
    reconstructed: Number(recoveryResult.reconstructedPercentage) || 0,
    enhanced: Number(recoveryResult.enhancedPercentage) || 0,
    ai: Number(recoveryResult.aiInferredPercentage) || 0,
    unrecovered: Number.isFinite(Number(recoveryResult.unrecoverablePercentage))
      ? Number(recoveryResult.unrecoverablePercentage)
      : recoveryResult.finalClassification === 'VERIFIED_RECOVERED' ? 0 : 100
  } : null
  const aiAssessment = recoveryResult?.aiAssessment
  const initialCheck = uploadResult?.initialChecks?.[0]
  const reportFileName = uploadResult?.records?.[0]?.originalName || uploadResult?.records?.[0]?.fileName || 'recovered-artifact'
  const recoverability = recoveryResult ? Math.min(100, recoveryMetrics.system + recoveryMetrics.reconstructed + recoveryMetrics.enhanced + recoveryMetrics.ai) : 0
  const integrity = recoveryResult?.validation?.score ?? 0
  const missingRegions = recoveryResult?.validation?.checks?.filter(check => check.startsWith('FAIL:')).length ?? 0
  const evidencePath = analysisResult?.evidenceAnalysis?.verifiedFragments?.map(fragment => fragment.fileName).join(' -> ') || reportFileName
  const fragmentSummary = recoveryResult?.fragmentSummary || { totalFragments: 0, recoveredFragments: 0, missingFragments: 0 }
  const dataProfile = recoveryResult?.dataProfile
  const measuredStages = dataProfile ? [
    { label: 'Provided input', value: Number(dataProfile.providedBytes) || 0, className: 'provided-fill' },
    { label: 'Assembled data', value: Number(dataProfile.assembledBytes) || 0, className: 'assembled-fill' },
    { label: 'Recovered output', value: Number(dataProfile.recoveredOutputBytes) || 0, className: 'recover-fill' }
  ] : []
  const maxMeasuredBytes = Math.max(1, ...measuredStages.map(stage => stage.value))
  const formatMetadata = dataProfile?.formatMetadata || {}
  const evidenceChecks = [
    ['Structure', recoveryResult?.validation?.structureValid],
    ['Metadata', Boolean(initialCheck?.detectedType && initialCheck.detectedType !== 'UNKNOWN')],
    ['Similarity', Boolean(analysisResult?.evidenceAnalysis?.verifiedFragments?.length || uploadResult?.count === 1)]
  ]
  const fragments = analysisResult?.evidenceAnalysis?.allFragments || []
  const verifiedFragments = analysisResult?.evidenceAnalysis?.verifiedFragments || []
  const analysisStages = [
    ['SIGNATURE', Boolean(initialCheck?.detectedType && initialCheck.detectedType !== 'UNKNOWN')],
    ['RELATIONSHIPS', Boolean(analysisResult)],
    ['RECONSTRUCTION', Boolean(recoveryResult)],
    ['VALIDATION', Boolean(recoveryResult?.validation)],
    ['AI REVIEW', Boolean(aiAssessment || !useAI)]
  ]

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark"><ShieldCheck size={20} /></span>
          <div>
            <strong>AEGISRECOVER</strong>
            <small>AI FORENSICS</small>
          </div>
        </div>
        <div className="system-state">
          <span className="pulse" /> PIPELINE ONLINE <span className="divider" /> STATUS: {statusText}
        </div>
      </header>

      <main className="page-main">
        <section className="hero-panel">
          <div>
            <p className="eyebrow">FORENSIC OPERATIONS / WORKFLOW</p>
            <h1>Recover and reconstruct digital evidence with traceable forensic analysis.</h1>
          </div>
        </section>

        {busy && <div className="processing-overlay" aria-live="polite">
          <div className="processing-orbit"><LoaderCircle size={42} /><span /></div>
          <strong>{processingStage === 'analysis' ? 'Analyzing evidence' : processingStage === 'ai' ? 'AI reviewing anomalies' : processingStage === 'recovery' ? 'Recovering and validating files' : 'Generating forensic report'}</strong>
          <div className="executing-stage">Executing stage: <b>{processingStage.toUpperCase()}</b></div>
          <span>{statusText}</span>
          <div className="processing-steps">{['analysis', 'ai', 'recovery', 'report'].map(stage => <i className={processingStage === stage ? 'active' : ''} key={stage} />)}</div>
          <small className="processing-note">Please wait while the evidence pipeline completes this stage.</small>
        </div>}

        {screen === 'home' && (
          <section className="home-page card-panel">
            <div className="page-header">
              <div>
                <span className="section-index">01</span>
                <h2>Choose a forensic workflow</h2>
              </div>
            </div>

            <div className="dashboard-summary">
              <div><span>PIPELINE</span><strong>Evidence-first</strong><small>Deterministic checks run before AI.</small></div>
              <div><span>AI ROLE</span><strong>Optional assistant</strong><small>Inference is separated from verified data.</small></div>
              <div><span>OUTPUTS</span><strong>Original + recovered</strong><small>Separate files, hashes, and report.</small></div>
            </div>

            <div className="workflow-grid single-action-grid">
              <button className="workflow-card" onClick={() => setScreen('upload')}>
                <UploadCloud size={22} />
                <strong>Upload Evidence</strong>
                <span>Collect damaged files or evidence fragments from the case folder.</span>
              </button>
            </div>

            <div className="hint-box">
              <h3>Recommended input</h3>
              <p>Select the bundled case sample files from the damaged input folder, such as:</p>
              <div className="sample-list">{demoFiles.map(name => <span key={name}>{name}</span>)}</div>
            </div>
          </section>
        )}

        {screen === 'upload' && (
          <section className="card-panel">
            <div className="page-header">
              <div>
                <span className="section-index">02</span>
                <h2>Evidence intake</h2>
              </div>
            </div>

            <div className="mode-switch">
              <button className={uploadMode === 'fragment' ? 'mode-btn active' : 'mode-btn'} onClick={() => setUploadMode('fragment')}>Fragment batch</button>
              <button className={uploadMode === 'single' ? 'mode-btn active' : 'mode-btn'} onClick={() => setUploadMode('single')}>Single damaged file</button>
            </div>

            <label className="ai-option">
              <input type="checkbox" checked={useAI} onChange={event => setUseAI(event.target.checked)} />
              <span><strong>Enable optional AI review</strong><small>System validation always runs first. AI may explain anomalies, but it cannot replace evidence-backed recovery.</small></span>
            </label>

            <label className="dropzone">
              <input type="file" multiple accept="*/*" onChange={handleFileSelect} />
              <UploadCloud size={32} />
              <strong>{selectedFiles.length ? `${selectedFiles.length} file${selectedFiles.length > 1 ? 's' : ''} selected` : 'Choose case evidence'}</strong>
              <span>PDF, JPG, JPEG, PNG, TXT, TEX, ZIP, DOCX, CSV, video, databases, or any other evidence file.</span>
            </label>

            <label className="description-box">
              <span className="description-label">Case description or problem</span>
              <textarea
                rows={4}
                value={userDescription}
                onChange={(event) => setUserDescription(event.target.value)}
                placeholder=""
              />
            </label>

            <button className="primary-action" disabled={!selectedFiles.length || busy} onClick={handleUpload}>
              {busy ? 'Processing upload, analysis, recovery...' : `Upload and process ${selectedFiles.length > 1 || uploadMode === 'fragment' ? 'fragment set' : 'single file'}`}
            </button>

            {error && <div className="error-box">{error}</div>}

            {uploadResult && (
              <div className="result-box">
                <h3>Upload result</h3>
                <p><strong>Count:</strong> {uploadResult.count}</p>
                <div className="initial-check-heading"><CheckCircle2 size={16} /> Initial system check completed before recovery</div>
                <div className="initial-check-grid">
                  {(uploadResult.initialChecks || []).map(check => (
                    <div className="initial-check" key={`${check.fileName}-${check.sha256}`}>
                      <strong>{check.fileName}</strong>
                      <span>Type: {check.detectedType} | Damage: {check.damageStatus}</span>
                      <span>System score: {check.validation?.score ?? 0}/100 | Signature: {check.validation?.signatureValid ? 'VALID' : 'INVALID'}</span>
                    </div>
                  ))}
                </div>
                <ul>
                  {uploadResult.records.map(item => (
                    <li key={item.fileId || item.evidenceId} className="evidence-row">
                      <a className="original-file-link" href={`${API_URL}/preview/original/${item.fileId || item.evidenceId}`} target="_blank" rel="noreferrer">{item.originalName || item.fileName}</a>
                      <span>— {item.fileId || item.evidenceId}</span>
                      <a className="download-btn" href={`${API_URL}/download/original/${item.fileId || item.evidenceId}`} download><Download size={14} /> Download original</a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        {screen === 'report' && (
          <section className="card-panel">
            <div className="page-header">
              <div>
                <span className="section-index">05</span>
                <h2>Final forensic report</h2>
              </div>
            </div>

            {error && <div className="error-box">{error}</div>}

            {reportText && (
              <div className="result-box big-box">
                <div className="recovery-complete-card">
                  <div className="recovery-complete-title">RECOVERY COMPLETE</div>
                  <strong className="recovery-file-name">{reportFileName}</strong>
                  {userDescription && <div className="case-description">Case description: <b>{userDescription}</b></div>}
                  <div className="fragment-count-box">
                    <span>Total fragments: <b>{fragmentSummary.totalFragments}</b></span>
                    <span>Recovered: <b>{fragmentSummary.recoveredFragments}</b></span>
                    <span>Missing: <b>{fragmentSummary.missingFragments}</b></span>
                  </div>
                  <div className="data-graph-panel">
                    <div className="graph-header">
                      <span>Processed data profile</span>
                      <small>{dataProfile?.fileType || 'UNKNOWN'} · {dataProfile?.damageStatus || 'NOT PROCESSED'}</small>
                    </div>
                    <div className="size-bars">
                      {measuredStages.map(stage => (
                        <div className="size-bar-line" key={stage.label}>
                          <span className="bar-label">{stage.label}</span>
                          <div className="bar-track"><i style={{ width: `${(stage.value / maxMeasuredBytes) * 100}%` }} className={stage.className} /></div>
                          <strong>{stage.value.toLocaleString()} B</strong>
                        </div>
                      ))}
                    </div>
                    <div className="data-profile-facts">
                      <span>Estimated original size <b>{dataProfile?.estimatedOriginalBytes == null ? 'Not available' : `${Number(dataProfile.estimatedOriginalBytes).toLocaleString()} B`}</b></span>
                      <span>Estimated missing bytes <b>{dataProfile?.estimatedMissingBytes == null ? 'Not measurable' : `${Number(dataProfile.estimatedMissingBytes).toLocaleString()} B`}</b></span>
                    </div>
                    {Object.keys(formatMetadata).length > 0 && <div className="format-metadata">
                      <strong>Detected format details</strong>
                      <div>{Object.entries(formatMetadata).map(([key, value]) => (
                        <span key={key}>{key}: <b>{Array.isArray(value) ? value.join(', ') : String(value)}</b></span>
                      ))}</div>
                    </div>}
                  </div>
                  <div className="complete-metrics">
                    <span>Recoverability <b>{recoverability}%</b></span>
                    <span>Integrity <b>{integrity}%</b></span>
                  </div>
                  <div className="classification-breakdown" aria-label="Recovery classification breakdown">
                    <span className="verified"><b>Verified Recovered</b><strong>{recoveryMetrics.system}%</strong></span>
                    <span className="reconstructed"><b>Reconstructed</b><strong>{recoveryMetrics.reconstructed}%</strong></span>
                    <span className="enhanced"><b>Enhanced <small>not requested</small></b><strong>{recoveryMetrics.enhanced}%</strong></span>
                    <span className="ai"><b>AI Inferred</b><strong>{recoveryMetrics.ai}%</strong></span>
                    <span className="unrecoverable"><b>Unrecoverable</b><strong>{recoveryMetrics.unrecovered}%</strong></span>
                  </div>
                  <div className="fragment-path">{evidencePath}</div>
                  <div className="missing-regions">Missing regions: <b>{missingRegions}</b></div>
                  <div className="evidence-heading">Evidence:</div>
                  <div className="evidence-checks">
                    {evidenceChecks.map(([label, passed]) => <span key={label} className={passed ? 'passed' : 'failed'}>{passed ? '✓' : '×'} {label}</span>)}
                  </div>
                  <div className="upload-status">Input status: <b>{initialCheck?.damageStatus || 'ASSESSED'}</b> | Type: <b>{initialCheck?.detectedType || 'UNKNOWN'}</b></div>
                </div>
                {comparison && <div className="before-after-panel">
                  <div className="board-header"><span>Before / after comparison</span><small>Original preserved separately</small></div>
                  <div className="comparison-grid">
                    <div className="comparison-card"><span>BEFORE / ORIGINAL</span><strong>{comparison.fileName}</strong><small>{comparison.original.size} bytes | {comparison.original.damageStatus}</small><code>{comparison.original.sha256}</code><a className="download-btn" href={`${API_URL}/download/original/${uploadResult?.records?.[0]?.fileId || uploadResult?.records?.[0]?.evidenceId}`} download><Download size={14} /> Download original</a></div>
                    <div className="comparison-card after"><span>AFTER / RECOVERED</span><strong>{comparison.fileName}</strong><small>{comparison.recovered.size} bytes | validation {comparison.recovered.validation?.score ?? 0}%</small><code>{comparison.recovered.sha256}</code><a className="download-btn" href={`${API_URL}/download/recovered/${comparison.recoveryId}`} download><Download size={14} /> Download recovered</a></div>
                  </div>
                  <div className="comparison-summary"><span>Byte identical: <b>{comparison.comparison.byteIdentical ? 'YES' : 'NO'}</b></span><span>Size ratio: <b>{comparison.comparison.sizeRatio}%</b></span><span>Original preserved: <b>YES</b></span></div>
                  {(comparison.detectedType === 'JPG' || comparison.detectedType === 'PNG') && <div className="image-compare"><div><span>Original image</span><img src={`${API_URL}/preview/original/${uploadResult?.records?.[0]?.fileId || uploadResult?.records?.[0]?.evidenceId}`} alt="Original uploaded evidence" /></div><div><span>Recovered image</span><img src={`${API_URL}/preview/recovered/${comparison.recoveryId}`} alt="Recovered evidence" /></div></div>}
                </div>}
                <h3>Generated markdown output</h3>
                <div className="report-downloads">
                  <strong>Download evidence</strong>
                  {recoveryResult?.recoveryId && <a className="download-btn" href={`${API_URL}/reports/${recoveryResult.recoveryId}/download?format=markdown`} download><FileText size={14} /> Download markdown report</a>}
                  {recoveryResult?.recoveryId && <a className="download-btn" href={`${API_URL}/reports/${recoveryResult.recoveryId}/download?format=pdf`} download><FileText size={14} /> Download PDF report</a>}
                  {recoveryResult?.recoveryId && <a className="download-btn" href={`${API_URL}/reports/${recoveryResult.recoveryId}?format=json`} download><FileText size={14} /> Download JSON report</a>}
                  {(uploadResult?.records || []).map(item => (
                    <a className="download-btn" key={item.fileId || item.evidenceId} href={`${API_URL}/download/original/${item.fileId || item.evidenceId}`} download><Download size={14} /> Original: {item.originalName || item.fileName}</a>
                  ))}
                  {recoveryResult?.recoveryId && <a className="download-btn" href={`${API_URL}/export/package/${recoveryResult.recoveryId}`} download><Archive size={14} /> Complete evidence package</a>}
                  {recoveryResult?.recoveryId && <a className="download-btn" href={`${API_URL}/download/recovered/${recoveryResult.recoveryId}`} download><Download size={14} /> Recovered file</a>}
                </div>
                <pre>{reportText}</pre>
              </div>
            )}
          </section>
        )}
      </main>

      <footer className="bottom-bar">
        <span>AEGISRECOVER</span>
        <span><Activity size={13} /> {uploadResult ? evidenceCount : 0} evidence items loaded</span>
      </footer>
    </div>
  )
}

export default App
