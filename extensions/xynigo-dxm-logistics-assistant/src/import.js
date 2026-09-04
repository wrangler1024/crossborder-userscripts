(function initXynigoDxmLogisticsImport(root, factory) {
  'use strict';

  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.XynigoDxmLogisticsImport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createImportTools() {
  'use strict';

  const HEADER_ALIASES = Object.freeze({
    orderNo: Object.freeze(['订单号', '采购子单号']),
    trackingNo: Object.freeze(['物流单号', '跟踪号', '运单号']),
    carrier: Object.freeze(['物流商渠道', '物流商', '物流渠道', '承运商']),
  });

  function normalizeHeader(value) {
    return String(value == null ? '' : value)
      .replace(/^\uFEFF/, '')
      .replace(/[\s：:（）()_-]+/g, '')
      .trim()
      .toLowerCase();
  }

  function parseDelimitedText(text, delimiter = ',') {
    const source = String(text == null ? '' : text).replace(/^\uFEFF/, '');
    if (!source) return [];
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    for (let index = 0; index < source.length; index += 1) {
      const character = source[index];
      if (quoted) {
        if (character === '"' && source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else if (character === '"') {
          quoted = false;
        } else {
          field += character;
        }
        continue;
      }
      if (character === '"' && field === '') {
        quoted = true;
      } else if (character === delimiter) {
        row.push(field);
        field = '';
      } else if (character === '\n' || character === '\r') {
        if (character === '\r' && source[index + 1] === '\n') index += 1;
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else {
        field += character;
      }
    }
    if (quoted) throw new Error('CSV 文件存在未闭合的双引号');
    if (field !== '' || row.length > 0) {
      row.push(field);
      rows.push(row);
    }
    return rows;
  }

  function elementsByLocalName(node, localName) {
    return Array.from(node?.getElementsByTagName?.('*') || [])
      .filter((element) => element.localName === localName || element.nodeName === localName);
  }

  function firstElementByLocalName(node, localName) {
    return elementsByLocalName(node, localName)[0] || null;
  }

  function attributeByLocalName(element, localName) {
    const direct = element?.getAttribute?.(localName);
    if (direct != null) return direct;
    return Array.from(element?.attributes || [])
      .find((attribute) => attribute.localName === localName || attribute.name === localName)?.value || '';
  }

  function parseXml(xmlText, DomParser) {
    const documentNode = new DomParser().parseFromString(String(xmlText || '').replace(/^\uFEFF/, ''), 'application/xml');
    if (elementsByLocalName(documentNode, 'parsererror').length) throw new Error('Excel 文件 XML 结构无效');
    return documentNode;
  }

  function sharedStringValues(documentNode) {
    return elementsByLocalName(documentNode, 'si').map((item) => (
      elementsByLocalName(item, 't').map((element) => element.textContent || '').join('')
    ));
  }

  function columnIndexFromReference(reference) {
    const letters = String(reference || '').toUpperCase().match(/^[A-Z]+/)?.[0] || '';
    return letters.split('').reduce((value, character) => value * 26 + character.charCodeAt(0) - 64, 0) - 1;
  }

  function worksheetCellValue(cell, sharedStrings) {
    const formula = firstElementByLocalName(cell, 'f')?.textContent;
    const type = attributeByLocalName(cell, 't');
    const valueNode = firstElementByLocalName(cell, 'v');
    let value = '';
    if (type === 'inlineStr') {
      value = elementsByLocalName(cell, 't').map((element) => element.textContent || '').join('');
    } else if (type === 's') {
      const index = Number(valueNode?.textContent || -1);
      value = Number.isInteger(index) && index >= 0 ? (sharedStrings[index] || '') : '';
    } else if (type === 'str') {
      value = valueNode?.textContent || '';
    } else if (type === 'b') {
      value = valueNode?.textContent === '1' ? 'TRUE' : 'FALSE';
    } else if (valueNode?.textContent != null && valueNode.textContent !== '') {
      const numeric = Number(valueNode.textContent);
      value = Number.isFinite(numeric) ? numeric : valueNode.textContent;
    }
    return formula == null ? value : { formula, result: value };
  }

  function normalizeWorksheetTarget(target) {
    const withoutSlash = String(target || '').replace(/^\/+/, '');
    if (withoutSlash.startsWith('xl/')) return withoutSlash;
    const segments = withoutSlash.split('/').filter((segment) => segment && segment !== '.');
    while (segments[0] === '..') segments.shift();
    return `xl/${segments.join('/')}`;
  }

  async function parseXlsxRows(buffer, ZipLibrary, DomParser) {
    if (!ZipLibrary?.loadAsync || typeof DomParser !== 'function') {
      throw new Error('Excel 解析组件未加载，请刷新店小秘页面后重试');
    }
    let zip;
    try {
      zip = await ZipLibrary.loadAsync(buffer);
    } catch (_error) {
      throw new Error('无法打开 Excel 文件，请确认文件未损坏且格式为 .xlsx');
    }
    const readEntry = async (name, required = true) => {
      const entry = zip.file(name);
      if (!entry) {
        if (!required) return '';
        throw new Error(`Excel 文件缺少必要结构：${name}`);
      }
      const content = await entry.async('string');
      if (content.length > 12 * 1024 * 1024) throw new Error(`Excel 文件内容过大：${name}`);
      return content;
    };
    const workbookDocument = parseXml(await readEntry('xl/workbook.xml'), DomParser);
    const relationshipsDocument = parseXml(await readEntry('xl/_rels/workbook.xml.rels'), DomParser);
    const sheetElements = elementsByLocalName(workbookDocument, 'sheet');
    const selectedSheet = sheetElements.find((sheet) => attributeByLocalName(sheet, 'name') === '发货导入')
      || sheetElements[0];
    if (!selectedSheet) throw new Error('Excel 文件中没有可读取的工作表');
    const relationshipId = attributeByLocalName(selectedSheet, 'id');
    const relationship = elementsByLocalName(relationshipsDocument, 'Relationship')
      .find((item) => attributeByLocalName(item, 'Id') === relationshipId);
    if (!relationship) throw new Error('Excel 文件无法定位导入工作表');
    const worksheetPath = normalizeWorksheetTarget(attributeByLocalName(relationship, 'Target'));
    const worksheetDocument = parseXml(await readEntry(worksheetPath), DomParser);
    const sharedStringsXml = await readEntry('xl/sharedStrings.xml', false);
    const sharedStrings = sharedStringsXml
      ? sharedStringValues(parseXml(sharedStringsXml, DomParser))
      : [];
    const rows = [];
    elementsByLocalName(worksheetDocument, 'row').forEach((rowElement) => {
      const rowNumber = Number(attributeByLocalName(rowElement, 'r'));
      if (!Number.isInteger(rowNumber) || rowNumber <= 0 || rowNumber > 5002) return;
      const values = ['', '', ''];
      elementsByLocalName(rowElement, 'c').forEach((cell) => {
        const columnIndex = columnIndexFromReference(attributeByLocalName(cell, 'r'));
        if (columnIndex < 0 || columnIndex > 2) return;
        values[columnIndex] = worksheetCellValue(cell, sharedStrings);
      });
      rows[rowNumber - 1] = values;
    });
    return Array.from({ length: rows.length }, (_, index) => rows[index] || ['', '', '']);
  }

  function cellKind(value) {
    if (value == null) return 'empty';
    if (typeof value === 'number') return 'number';
    if (typeof value === 'object') {
      if (Object.prototype.hasOwnProperty.call(value, 'formula')) return 'formula';
      return 'object';
    }
    return 'text';
  }

  function cellText(value) {
    if (value == null) return '';
    if (typeof value === 'object') {
      if (Array.isArray(value.richText)) {
        return value.richText.map((part) => part?.text || '').join('').trim();
      }
      if (typeof value.text === 'string') return value.text.trim();
      if (value.result != null) return String(value.result).trim();
    }
    return String(value).trim();
  }

  function findHeaderRow(rows) {
    const candidates = (Array.isArray(rows) ? rows : []).slice(0, 10);
    for (let rowIndex = 0; rowIndex < candidates.length; rowIndex += 1) {
      const normalized = candidates[rowIndex].map(normalizeHeader);
      const indexes = {};
      Object.entries(HEADER_ALIASES).forEach(([field, aliases]) => {
        indexes[field] = normalized.findIndex((header) => aliases.map(normalizeHeader).includes(header));
      });
      if (Object.values(indexes).every((index) => index >= 0)) {
        return { rowIndex, indexes };
      }
    }
    return null;
  }

  function remapIssue(issue, sourceRows, prefix = 'Excel') {
    if (!issue?.line) return issue;
    const sourceRow = sourceRows[issue.line - 1] || issue.line;
    return {
      ...issue,
      line: sourceRow,
      message: String(issue.message || '').replace(`第 ${issue.line} 行`, `${prefix} 第 ${sourceRow} 行`),
    };
  }

  function rowsToInput(rows, core, options = {}) {
    if (!core || typeof core.parseInput !== 'function') throw new Error('物流助手校验模块未加载');
    const header = findHeaderRow(rows);
    if (!header) {
      return {
        ok: false,
        entries: [],
        input: '',
        errors: [{ line: 0, code: 'headers_missing', message: '未找到模板表头：订单号、物流单号、物流商渠道' }],
        warnings: [],
      };
    }
    const errors = [];
    const sourceRows = [];
    const normalizedLines = [];
    const sourceLabel = options.sourceLabel || 'Excel';
    const maxScanRows = Number.isInteger(options.maxScanRows) ? options.maxScanRows : 5000;
    const dataRows = rows.slice(header.rowIndex + 1, header.rowIndex + 1 + maxScanRows);
    dataRows.forEach((row, relativeIndex) => {
      const sourceRow = header.rowIndex + relativeIndex + 2;
      const values = {
        orderNo: row?.[header.indexes.orderNo],
        trackingNo: row?.[header.indexes.trackingNo],
        carrier: row?.[header.indexes.carrier],
      };
      const texts = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, cellText(value)]));
      if (!texts.orderNo && !texts.trackingNo && !texts.carrier) return;
      const formulaField = Object.entries(values).find(([, value]) => cellKind(value) === 'formula');
      if (formulaField) {
        errors.push({
          line: sourceRow,
          code: 'formula_not_allowed',
          message: `${sourceLabel} 第 ${sourceRow} 行不能使用公式，请粘贴为文本值`,
        });
        return;
      }
      const missing = [];
      if (!texts.orderNo) missing.push('订单号');
      if (!texts.trackingNo) missing.push('物流单号');
      if (!texts.carrier) missing.push('物流商渠道');
      if (missing.length) {
        errors.push({
          line: sourceRow,
          code: 'required_field_missing',
          message: `${sourceLabel} 第 ${sourceRow} 行缺少${missing.join('、')}`,
        });
        return;
      }
      if (cellKind(values.trackingNo) === 'number') {
        errors.push({
          line: sourceRow,
          code: 'tracking_number_not_text',
          message: `${sourceLabel} 第 ${sourceRow} 行物流单号是数字单元格，请改为文本格式后重新粘贴，避免长单号丢位`,
        });
        return;
      }
      if (/^[+-]?(?:\d+(?:\.\d+)?)[eE][+-]?\d+$/.test(texts.trackingNo)) {
        errors.push({
          line: sourceRow,
          code: 'tracking_scientific_notation',
          message: `${sourceLabel} 第 ${sourceRow} 行物流单号是科学计数法，请从原始单号重新按文本填写`,
        });
        return;
      }
      const carrier = core.resolveCarrier(texts.carrier, '');
      if (!carrier) {
        errors.push({
          line: sourceRow,
          code: 'carrier_invalid',
          message: `${sourceLabel} 第 ${sourceRow} 行物流商“${texts.carrier}”不受支持`,
        });
        return;
      }
      sourceRows.push(sourceRow);
      normalizedLines.push(`${texts.orderNo}\t${texts.trackingNo}\t${carrier}`);
    });
    if (rows.length > header.rowIndex + 1 + maxScanRows) {
      errors.push({
        line: 0,
        code: 'scan_limit_exceeded',
        message: `文件行数过多；只允许在前 ${maxScanRows} 行内填写`,
      });
    }
    if (errors.length) return { ok: false, entries: [], input: '', errors, warnings: [] };
    const parsed = core.parseInput(normalizedLines.join('\n'), {
      defaultCarrier: 'UPS',
      maxEntries: options.maxEntries,
    });
    return {
      ...parsed,
      errors: parsed.errors.map((issue) => remapIssue(issue, sourceRows, sourceLabel)),
      warnings: parsed.warnings.map((issue) => remapIssue(issue, sourceRows, sourceLabel)),
      input: parsed.entries.map((entry) => (
        `${entry.orderNo}\t${entry.trackingNo}\t${entry.providerName}`
      )).join('\n'),
      headerRow: header.rowIndex + 1,
    };
  }

  return Object.freeze({
    HEADER_ALIASES,
    normalizeHeader,
    parseDelimitedText,
    parseXlsxRows,
    rowsToInput,
  });
});
