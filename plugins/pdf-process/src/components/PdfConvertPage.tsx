import WorkspaceFiles from '../components/WorkspaceFiles'
import OperationResult from '../components/OperationResult'
import FeatureLayout from '../components/FeatureLayout'
import ConvertWebRecommend from '../components/ConvertWebRecommend'
import { useOperation } from '../hooks/useOperation'
import { useSharedFiles } from '../context/SharedFilesContext'
import {
  generateTaskId,
  buildTaskOutputPath,
  buildConvertedFilename,
} from '../hooks/useTaskFolder'
import type { ConvertWebFormat } from '../config/webConvertLinks'
import './PdfConvertPage.css'

export type ConvertFormat = 'word' | 'ppt' | 'excel'

const FORMAT_META: Record<
  ConvertFormat,
  { title: string; feature: string; ext: string; recommend: ConvertWebFormat }
> = {
  word: { title: 'PDF 转 Word', feature: 'word', ext: '.docx', recommend: 'word' },
  ppt: { title: 'PDF 转 PPT', feature: 'ppt', ext: '.pptx', recommend: 'ppt' },
  excel: { title: 'PDF 转 Excel', feature: 'excel', ext: '.xlsx', recommend: 'excel' },
}

interface PdfConvertPageProps {
  format: ConvertFormat
  onBack?: () => void
  onOpenSettings?: () => void
}

/** One Convert feature module parameterized by format (Word / PPT / Excel). */
export default function PdfConvertPage({ format, onOpenSettings }: PdfConvertPageProps) {
  const meta = FORMAT_META[format]
  const { files, selectedFiles, clear } = useSharedFiles()
  const { processing, result, error, execute, cancel } = useOperation<string[]>()
  const targets = selectedFiles.length > 0 ? selectedFiles : files

  const handleConvert = () => {
    if (targets.length === 0) return
    execute(
      async () => {
        const outputs: string[] = []
        for (const file of targets) {
          const taskId = generateTaskId(file.name || file.path)
          const outputPath = buildTaskOutputPath(
            window.ztools.getPath('downloads'),
            meta.feature,
            buildConvertedFilename(file.name || file.path, meta.ext),
            taskId,
          )
          await window.services.convertPdf(file.path, outputPath, format)
          outputs.push(outputPath)
        }
        return outputs
      },
      () => {
        window.ztools.showNotification('转换完成（' + targets.length + ' 个）')
      },
    )
  }

  return (
    <FeatureLayout
      title={meta.title}
      subtitle="可多选多个 PDF，按任务批量转换"
      action={
        files.length > 0 ? (
          <div className="convert-options">
            {onOpenSettings && (
              <button type="button" className="settings-link-btn" onClick={onOpenSettings}>
                打开设置
              </button>
            )}
            {!processing && (
              <button className="action-btn" onClick={handleConvert} disabled={targets.length === 0}>
                开始转换（{targets.length}）
              </button>
            )}
            {processing && (
              <button className="action-btn" onClick={cancel} style={{ background: '#e74c3c' }}>
                停止
              </button>
            )}
            {error && <p className="error-text">转换失败：{error}</p>}
          </div>
        ) : null
      }
      result={<OperationResult result={result} onReset={clear} />}
    >
      <ConvertWebRecommend format={meta.recommend} onOpenSettings={onOpenSettings} />
      <WorkspaceFiles
        title={meta.title}
        subtitle="将 PDF 转换为目标格式（可多选）"
        multiple
        layout="list"
        selectable
        multiSelect
      />
    </FeatureLayout>
  )
}
