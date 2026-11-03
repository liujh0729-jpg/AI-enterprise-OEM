import { Logger } from '../common/logger';
import {
  type ChannelSubmitResult,
  type ExternalChannel,
  type ExternalTask,
} from './external.types';
/**
 * 人工通道（默认启用）：本系统生成报文与作业指引，由承办职员在官方系统人工报送，
 * 完成后回填受理号/回执。不依赖任何外部资质，因此是阶段 1 的默认通道。
 */
export class ManualChannel implements ExternalChannel {
  readonly code = 'MANUAL';
  readonly name = '人工通道（电子税务局 / 单一窗口人工报送）';
  readonly bizType = 'TAX' as const;
  readonly targetSystem = '全国统一规范电子税务局';
  private readonly logger = new Logger(ManualChannel.name);
  submit(task: ExternalTask): Promise<ChannelSubmitResult> {
    this.logger.log(
      `manual submit queued ref=${task.refType}#${task.refId} hash=${task.payloadHash.slice(0, 12)}`,
    );
    return Promise.resolve({
      status: 'QUEUED',
      acceptNo: '',
      message: '已生成报送报文与作业指引，请在官方系统人工报送后回填受理号',
    });
  }
  queryReceipt(
    task: ExternalTask,
    acceptNo: string,
  ): Promise<ChannelSubmitResult> {
    return Promise.resolve({
      status: 'QUEUED',
      acceptNo,
      message: `人工通道无直连查询能力：请在官方系统核对 ${task.refNo || task.refType} 的申报结果后回填回执`,
    });
  }
  async cancel(): Promise<void> {
    // 人工通道无远端单据，作废仅在本系统登记
  }
}
/**
 * 通道注册表：只注册「本系统已实现」的通道。
 * TAX_SP（持牌税务服务商）/ TAX_DIRECT（税企直连）/ CUSTOMS_SP（报关服务商）
 * 需外部资质与密钥（见 需求/报税与海关系统对接方案.md §7），未开通前不出现在此表。
 */
export const CHANNEL_REGISTRY: Record<string, ExternalChannel> = {
  MANUAL: new ManualChannel(),
};
/** 通道元数据（含未开通通道，用于前端展示「开通所需条件」）。 */
export const CHANNEL_CATALOG = [
  {
    code: 'MANUAL',
    name: '人工通道',
    bizType: 'TAX',
    implemented: true,
    requiring: [] as string[],
  },
  {
    code: 'TAX_SP',
    name: '持牌税务服务商通道',
    bizType: 'TAX',
    implemented: false,
    requiring: [
      '税务服务商合同与 API 密钥（client_id/secret、沙箱）',
      '各地电子税务局报文规范',
    ],
  },
  {
    code: 'TAX_DIRECT',
    name: '税企直连通道',
    bizType: 'TAX',
    implemented: false,
    requiring: ['企业 CA/UKey 或电子税务局子账号', '银税三方协议（扣款）'],
  },
  {
    code: 'CUSTOMS_SP',
    name: '报关服务商通道（单一窗口）',
    bizType: 'CUSTOMS',
    implemented: false,
    requiring: [
      '报关资质或报关行合作',
      '电子口岸 IC 卡 / 法人卡',
      '出口退税资质与退税账户',
    ],
  },
] as const;
