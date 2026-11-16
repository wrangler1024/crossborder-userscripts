import { getNativeContext } from './native-context.mjs';
import { UPDATE_GROUPS } from './workbook.mjs';
export const NATIVE_IMPORT_PATH = '/ak-import-center/erp/import/001/excel';
export const NATIVE_IMPORT_BUSINESS = '001001002';
export function selectedNativeFields(component) { return (component.skuUpdate || []).flatMap(group => group.value || []).filter(Boolean).sort(); }
export function validateNativeImport(component, uploader) {
  const data = component.importChildData;
  if (data?.params?.product_type !== 'sku' || data.params.import_type !== 'set' || data.businessId !== NATIVE_IMPORT_BUSINESS) throw new Error('领星原生更新配置已变化，已停止');
  if (JSON.stringify(selectedNativeFields(component)) !== JSON.stringify([...UPDATE_GROUPS].sort()) || data.params.selected_fields?.split(',').sort().join(',') !== [...UPDATE_GROUPS].sort().join(',')) throw new Error('原生更新内容包含额外字段或缺少包装字段，已停止');
  const action = new URL(uploader.action);
  if (action.origin !== 'https://gw.lingxingerp.com' || action.pathname !== NATIVE_IMPORT_PATH || uploader.autoUpload !== true || uploader.accept !== '.xlsx') throw new Error('领星原生上传入口已变化，已停止');
  const payload = uploader.data;
  if (payload?.businessId !== NATIVE_IMPORT_BUSINESS) throw new Error('原生上传业务类型不一致');
  const params = JSON.parse(payload.extParams || '{}');
  if (Object.keys(params).sort().join(',') !== 'import_type,product_type,selected_fields' || params.product_type !== 'sku' || params.import_type !== 'set' || params.selected_fields?.split(',').sort().join(',') !== [...UPDATE_GROUPS].sort().join(',')) throw new Error('原生上传参数超出本次更新范围');
}
export function createNativeImporter(win, { context = () => getNativeContext(win) } = {}) {
  const handles = new WeakSet();
  return {
    async prepare({ signal } = {}) {
      const component = context(), previous = component.$refs?.compoundImport;
      if (!Array.isArray(component.skuUpdate) || !component.importChildData || typeof component.beforeUpload !== 'function') throw new Error('领星原生导入组件未就绪，请刷新产品管理页');
      if (component.importChildData.importDialogVisible || (previous?.uploadedFile && !['2', '3', '4'].includes(String(previous.importCenterStatus)))) throw new Error('请先完成或关闭当前原生导入窗口，再开始本批');
      let importer;
      try {
      // A cold page starts in ADD mode and does not mount its uploader until opened.
      component.importChildData.params = { product_type: 'sku', import_type: 'set' };
      component.importChildData.importDialogVisible = true;
      await component.$nextTick();
      for (let attempt = 0; ; attempt++) {
        if (signal?.aborted || component._isDestroyed) throw new Error('原生导入准备已停止');
        importer = component.$refs?.compoundImport;
        if (typeof importer?.computeImportData === 'function' && importer.$refs?.upload && importer.$el.querySelector('input[type=file]')) break;
        if (attempt >= 100) throw new Error('原生导入组件加载超时，请关闭窗口后重试');
        await new Promise(resolve => (win.setTimeout || setTimeout)(resolve, 50));
      }
      // A completed previous upload must not lend its task ID/status to the next batch.
      importer.importCenterTaskId = ''; importer.importCenterStatus = ''; importer.current_task = ''; importer.uploadedFile = null;
      importer.succ_num = 0; importer.fail_num = 0; importer.fileName = ''; importer.percentage = 0;
      importer.error_list = []; importer.success_list = []; importer.file_id = ''; importer.error_file_id = ''; importer.failTableLoading = false;
      importer.$refs?.upload?.clearFiles?.();
      for (const group of component.skuUpdate) group.value = [];
      const available = new Set();
      for (const group of component.skuUpdate) for (const option of group.options || []) if (UPDATE_GROUPS.includes(option.id)) { group.value.push(option.id); available.add(option.id); }
      if (available.size !== UPDATE_GROUPS.length) throw new Error('找不到原生包装字段，请刷新页面后核对');
      let denied = false;
      component.beforeUpload({}, () => { denied = true; });
      if (denied) throw new Error('领星阻止了本次更新配置');
      importer.importData = importer.computeImportData();
      await component.$nextTick();
      const uploader = importer.$refs?.upload;
      validateNativeImport(component, uploader);
      const input = importer.$el.querySelector('input[type=file]');
      if (!input || input.multiple) throw new Error('原生文件输入框结构变化，已停止');
      const handle = { component, importer, uploader, input, submitted: false };
      handles.add(handle); return handle;
      } catch (error) { component.importChildData.importDialogVisible = false; throw error; }
    },
    submit(handle, bytes, filename) {
      if (!handles.has(handle) || handle.submitted) throw new Error('本批原生提交凭证无效或已使用');
      validateNativeImport(handle.component, handle.uploader);
      if (handle.importer.$el.querySelector('input[type=file]') !== handle.input || !handle.input.isConnected) throw new Error('原生导入窗口已变化，未重新上传');
      const transfer = new win.DataTransfer();
      transfer.items.add(new win.File([bytes], filename, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      handle.submitted = true;
      handle.input.files = transfer.files;
      handle.input.dispatchEvent(new win.Event('change', { bubbles: true }));
    },
    status(handle) {
      if (!handles.has(handle)) return { phase: 'unknown', taskId: '' };
      const c = handle.importer;
      return { phase: ['2', '3', '4'].includes(String(c.importCenterStatus)) ? 'complete' : 'processing', taskId: String(c.importCenterTaskId || c.current_task || ''), successful: Number(c.succ_num || 0), failed: Number(c.fail_num || 0) };
    },
    cancel(handle) { if (handles.has(handle) && !handle.submitted) handle.component.importChildData.importDialogVisible = false; }
  };
}
