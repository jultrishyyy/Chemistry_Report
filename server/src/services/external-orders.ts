/**
 * 外部订单接口（适配层 / 接缝）—— 接口 1.1 PushOrderInfos「推送委托单信息」
 * ────────────────────────────────────────────────────────────────────────
 * 真实业务里，"有哪些委托单、每张单下有哪些样品、每个样品要做哪些测试项目"
 * 来自化学部上游的 LIMS / 委托管理系统（递归智能）。
 *
 * 本文件是那个外部接口的【唯一接缝 + 解析器】：
 *   - `parseOrderInfo(raw)`：把外部推送的 PascalCase JSON（接口 1.1 的 PushOrderInfos
 *     入参，结构见《递归智能接口文档》1.1 节 / 本文件 EXAMPLE_PUSH_ORDER）规范化为内部
 *     `ExternalOrder`。接收端点 `routes/external.ts` 的 POST /api/external/orders 调它入库。
 *   - `fetchExternalOrders()`：保留的"拉取"占位（返回空数组）。演示期改用界面「新建订单」
 *     或把示例 JSON POST 到接收端点。真实系统若是轮询拉取而非推送，把这里换成真实 HTTP。
 *
 * 接口契约（对齐《递归智能接口文档》1.1 + example.json）：
 *   ExternalOrder.samples[].test_infos[] = 一个"样品 × 测试项目（材料分单）"格子，
 *   它正是 record_data 的唯一上下文 (order_no, sample_external_id, test_item_name)，
 *   也是报告生成"按样品 / 按项目 / 自由"三种拆分粒度的最小原子。
 *   样品稳定 id 取 BarCode（接口唯一），报告侧（接口 1.2）按 样品名 + 项目名 回查关联。
 *
 * 详细的接口对接状态见根目录 `待实现内容.md` 第 1 节。
 */

/** 委托单【材料分单 / 测试项目】—— 接口 1.1 TaskList 的一项。name/standard 之外的字段供报告映射 binding(source='test') 拉取。 */
export interface ExternalTestInfo {
  /** 外部材料任务唯一标识 TaskId；审核完工后用接口 1.6 回传状态。 */
  task_id?: string;
  /** 测试项目名 ProjectName，对应 record_data.test_item_name */
  name: string;
  /** 检测标准号 StandardNo */
  standard?: string;
  /** 主机厂 MainEngineFactory */
  main_engine_factory?: string;
  /** 测试方法 TestMothed */
  test_method?: string;
  /** 测试条件 TestCondition */
  test_condition?: string;
  /** 制样方式 SamplingMode */
  sampling_mode?: string;
  /** 制样要求 SamplingRequirement */
  sampling_requirement?: string;
  /** 限值名称（牌号）LimitName */
  limit_name?: string;
  /** 限值内容 LimitContent */
  limit_content?: string;
  /** 分单负责人 Leader */
  leader?: string;
  /** 开始测试日期 StartDate（YYYY-MM-DD） */
  start_date?: string;
  /** 结束测试日期 EndDate（YYYY-MM-DD） */
  end_date?: string;
  /** 样品描述 SampleDescription */
  sample_description?: string;
  /** 检测备注 TestRemark */
  test_remark?: string;
  /** 分单人 MaterialUploader */
  material_uploader?: string;
  /** 制样备注 Remark */
  remark?: string;
}

/** 委托单【样品】—— 接口 1.1 SampleList 的一项。 */
export interface ExternalSample {
  /** 样品在本单内的稳定 id（= BarCode；缺省回退 s1/s2…），对应 record_data.sample_external_id */
  id: string;
  /** 样品名称 SampleName（报告侧接口 1.2 按它回查关联） */
  name: string;
  /** 样品条码 BarCode */
  barcode?: string;
  /** 序号 SampleSortNo（如 0#/1#/2#） */
  sort_no?: string;
  /** 型号 Model */
  model?: string;
  test_infos: ExternalTestInfo[];
}

/** 委托单【订单级】扩展元数据 —— 接口 1.1 订单级字段（除 order_no/customer_name/received_at 三个已提升为列的）。 */
export interface ExternalOrderMeta {
  /** 委托单位地址 CompanyAddress */
  company_address?: string;
  /** 送检日期 SendDate（原始 ISO 串，received_at 取其日期部分） */
  send_date?: string;
  /** 客户要求期限 TimeRequired */
  time_required?: string;
  /** 检测要求期限 TestTimeRequired */
  test_time_required?: string;
  /** 报告期限 ReportDeadLine */
  report_deadline?: string;
  /** 证书单位 Authorites */
  authorites?: string;
  /** 英文证书单位 EnglishAuthorites */
  english_authorites?: string;
  /** 证书单位地址 AuthoritesAddress */
  authorites_address?: string;
  /** 英文证书单位地址 EnglishAuthoritesAddress */
  english_authorites_address?: string;
  /** 业务员 SaleName */
  sale_name?: string;
  /** 业务员工号 JobNo */
  job_no?: string;
  /** 买家 Buyer */
  buyer?: string;
  /** 委托单状态 Status */
  status?: string;
  /** 备注 Remark */
  remark?: string;
  /** 是否出中文报告 IsChineseReport */
  is_chinese_report?: boolean;
  /** 是否出英文报告 IsEnglishReport */
  is_english_report?: boolean;
  /** 是否出纸质报告 IsPaperReport */
  is_paper_report?: boolean;
  /** 报告数量 ReportCount */
  report_count?: string;
  /** 其他报告数量 OtherReportCount */
  other_report_count?: string;
  /** 完工方式 CompleteWay */
  complete_way?: string;
}

export interface ExternalOrder {
  /** 委托单号 OrderNumber，对应 work_orders.order_no（主键） */
  order_no: string;
  /** 委托单位 CompanyName，对应 work_orders.customer_name */
  customer_name: string;
  /** 接收日期（= SendDate 的日期部分）YYYY-MM-DD */
  received_at: string;
  /** 订单级扩展元数据（存入 work_orders.payload.meta，供报告 binding(source='order') 拉取） */
  meta?: ExternalOrderMeta;
  samples: ExternalSample[];
}

const s = (v: any): string | undefined => {
  if (v === null || v === undefined) return undefined;
  const t = String(v).trim();
  return t === '' ? undefined : t;
};

/** ISO/Datetime 串取日期部分 YYYY-MM-DD；非日期串原样返回。 */
const dateOnly = (v: any): string | undefined => {
  const str = s(v);
  if (!str) return undefined;
  const m = str.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : str;
};

/**
 * 解析接口的 SampleList[]（样品 × 材料分单），1.1 委托单与 1.2 报告范围共用同一结构。
 * 同一样品下重复 ProjectName 去重（record_data 唯一键含 test_item_name），样品 id 取 BarCode。
 */
export function parseSampleList(rawList: any): { samples: ExternalSample[]; warnings: string[] } {
  const warnings: string[] = [];
  const usedIds = new Set<string>();
  const samples: ExternalSample[] = (Array.isArray(rawList) ? rawList : []).map((rs: any, i: number) => {
    const name = s(rs?.SampleName) || `样品${i + 1}`;
    // 样品稳定 id：优先 BarCode（接口唯一），回退序号位 s{n}；撞 id 再加后缀保证单内唯一
    let id = s(rs?.BarCode) || `s${i + 1}`;
    if (usedIds.has(id)) { let k = 2; while (usedIds.has(`${id}#${k}`)) k++; id = `${id}#${k}`; }
    usedIds.add(id);

    const seen = new Set<string>();
    const test_infos: ExternalTestInfo[] = [];
    for (const rt of (Array.isArray(rs?.TaskList) ? rs.TaskList : [])) {
      const tname = s(rt?.ProjectName);
      if (!tname) continue;
      if (seen.has(tname)) {
        warnings.push(`样品「${name}」存在重复测试项目「${tname}」，已合并为一项`);
        continue;
      }
      seen.add(tname);
      test_infos.push({
        task_id: s(rt?.TaskId),
        name: tname,
        standard: s(rt?.StandardNo),
        main_engine_factory: s(rt?.MainEngineFactory),
        test_method: s(rt?.TestMothed),
        test_condition: s(rt?.TestCondition),
        sampling_mode: s(rt?.SamplingMode),
        sampling_requirement: s(rt?.SamplingRequirement),
        limit_name: s(rt?.LimitName),
        limit_content: s(rt?.LimitContent),
        leader: s(rt?.Leader),
        start_date: dateOnly(rt?.StartDate),
        end_date: dateOnly(rt?.EndDate),
        sample_description: s(rt?.SampleDescription),
        test_remark: s(rt?.TestRemark),
        material_uploader: s(rt?.MaterialUploader),
        remark: s(rt?.Remark),
      });
    }
    return { id, name, barcode: s(rs?.BarCode), sort_no: s(rs?.SampleSortNo), model: s(rs?.Model), test_infos };
  });
  return { samples, warnings };
}

/**
 * 解析外部推送的【单张】委托单（接口 1.1 PushOrderInfos PascalCase JSON）为内部 ExternalOrder。
 * 返回规范化结果 + 告警（如同一样品下出现重复项目名 —— 与 record_data 唯一键冲突，已去重）。
 */
export function parseOrderInfo(raw: any): { order: ExternalOrder; warnings: string[] } {
  if (!raw || typeof raw !== 'object') throw new Error('订单数据为空或格式错误');

  const order_no = s(raw.OrderNumber);
  if (!order_no) throw new Error('OrderNumber（委托单号）不能为空');

  const { samples, warnings } = parseSampleList(raw.SampleList);

  const meta: ExternalOrderMeta = {
    company_address: s(raw.CompanyAddress),
    send_date: s(raw.SendDate),
    time_required: s(raw.TimeRequired),
    test_time_required: s(raw.TestTimeRequired),
    report_deadline: s(raw.ReportDeadLine),
    authorites: s(raw.Authorites),
    english_authorites: s(raw.EnglishAuthorites),
    authorites_address: s(raw.AuthoritesAddress),
    english_authorites_address: s(raw.EnglishAuthoritesAddress),
    sale_name: s(raw.SaleName),
    job_no: s(raw.JobNo),
    buyer: s(raw.Buyer),
    status: s(raw.Status),
    remark: s(raw.Remark),
    is_chinese_report: typeof raw.IsChineseReport === 'boolean' ? raw.IsChineseReport : undefined,
    is_english_report: typeof raw.IsEnglishReport === 'boolean' ? raw.IsEnglishReport : undefined,
    is_paper_report: typeof raw.IsPaperReport === 'boolean' ? raw.IsPaperReport : undefined,
    report_count: s(raw.ReportCount),
    other_report_count: s(raw.OtherReportCount),
    complete_way: s(raw.CompleteWay),
  };

  const order: ExternalOrder = {
    order_no,
    customer_name: s(raw.CompanyName) || '',
    received_at: dateOnly(raw.SendDate) || '',
    meta,
    samples,
  };
  return { order, warnings };
}

/** 解析一批（接口可能单条对象或数组推送）。 */
export function parseOrderInfos(raw: any): { orders: ExternalOrder[]; warnings: string[] } {
  const list = Array.isArray(raw) ? raw : [raw];
  const orders: ExternalOrder[] = [];
  const warnings: string[] = [];
  for (const item of list) {
    const r = parseOrderInfo(item);
    orders.push(r.order);
    warnings.push(...r.warnings);
  }
  return { orders, warnings };
}

/**
 * 拉取外部系统当前的委托单清单（占位）。
 *
 * ⚠️ 真实流程是"推送"（接口 1.1 PushOrderInfos，外部主动调我方 POST /api/external/orders，
 * 见 routes/external.ts）。这里保留"拉取"接缝返回空数组——演示期用界面「新建订单」
 * 或把示例 JSON POST 到接收端点。若外部系统是轮询拉取而非推送，把这里换成真实 HTTP 即可。
 */
export async function fetchExternalOrders(): Promise<ExternalOrder[]> {
  return [];
}

/** 接口 1.1 示例（取自《递归智能接口文档》1.1 节），供接收端点 mock 触发 / 联调用。 */
export const EXAMPLE_PUSH_ORDER = {
  OrderNumber: 'C202307190320',
  CompanyName: '浙江万盾制冷股份有限公司',
  CompanyAddress: '新昌县梅渚镇兴梅大道45号',
  SendDate: '2026-06-15T10:06:13',
  Authorites: '浙江万盾制冷股份有限公司',
  AuthoritesAddress: '新昌县梅渚镇兴梅大道45号',
  SaleName: '王树雪',
  JobNo: 'GDJL02859',
  Buyer: 'vivo,安踏（中国）有限公司',
  Status: '正常',
  IsChineseReport: true,
  ReportCount: '按委托单出报告',
  CompleteWay: '报告签发，自动完工',
  SampleList: [
    { SampleName: '化学样品1', SampleSortNo: '0#', BarCode: 'C202307190320-111', Model: null, TaskList: [
      { ProjectName: '燃烧特性', StandardNo: 'GB 8410', TestMothed: '水平燃烧', TestCondition: '常温', Leader: '穆阳阳', SampleDescription: '黑色内饰板', TestRemark: '' },
      { ProjectName: '雾化值', StandardNo: 'PV 3015', TestMothed: '重量法', TestCondition: '100℃', Leader: '穆阳阳', SampleDescription: '黑色内饰板', TestRemark: '' },
    ] },
    { SampleName: '化学样品2', SampleSortNo: '1#', BarCode: 'C202307190320-112', Model: null, TaskList: [] },
    { SampleName: '化学样品3', SampleSortNo: '2#', BarCode: 'C202307190320-113', Model: null, TaskList: [] },
  ],
};
