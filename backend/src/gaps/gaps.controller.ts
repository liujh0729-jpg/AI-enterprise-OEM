import type { CurrentUser } from '../auth/current-user';
import type { EntitlementService } from './entitlement.service';
import type { AppointmentService } from './appointment.service';
import type { MailTemplateService } from './mail-template.service';
import type { PageAssistantService } from './assistant.service';
import type { TranscriptionService } from './transcription.service';
import type { QuotationDocumentService } from './quotation-doc.service';
import type { TimeAuditService } from './time-audit.service';
import type { PromoService } from './promo.service';
import type { AfterSalesService } from './after-sales.service';
import type { ReviewService } from './review.service';
import type { TaskSyncService } from './task-sync.service';
import type { TermsService } from './terms.service';
import type { OnboardingService } from './onboarding.service';
import type { ChangelogService } from './changelog.service';
import type { OrgContextService } from './org-context.service';
import type { UsageService } from './usage.service';
import { asInt, asText, type Row } from './gaps.helpers';

/**
 * 附录 B 补齐项控制器：方法名与契约 operationId 后缀一一对应
 * （`Plan_plans` → `plans`），由 `moduleHandlers` 统一映射。
 */
export class EntitlementController {
  constructor(private readonly service: EntitlementService) {}

  plans(user: CurrentUser) {
    return this.service.listPlans(user);
  }

  savePlan(user: CurrentUser, body: Row) {
    return this.service.savePlan(user, body);
  }

  removePlan(user: CurrentUser, body: Row) {
    return this.service.removePlan(user, asInt(body.id, 0));
  }

  orgPlan(user: CurrentUser, query: Row) {
    return this.service.orgPlan(user, query);
  }

  assign(user: CurrentUser, body: Row) {
    return this.service.assign(user, body);
  }

  consume(user: CurrentUser, body: Row) {
    return this.service.consume(user, body);
  }
}

export class AppointmentController {
  constructor(private readonly service: AppointmentService) {}

  events(user: CurrentUser) {
    return this.service.events(user);
  }

  saveEvent(user: CurrentUser, body: Row) {
    return this.service.saveEvent(user, body);
  }

  removeEvent(user: CurrentUser, body: Row) {
    return this.service.removeEvent(user, asInt(body.id, 0));
  }

  slots(user: CurrentUser, query: Row) {
    return this.service.slots(user, query);
  }

  generateSlots(user: CurrentUser, body: Row) {
    return this.service.generateSlots(user, body);
  }

  bookings(user: CurrentUser, query: Row) {
    return this.service.bookings(user, query);
  }

  book(user: CurrentUser, body: Row) {
    return this.service.book(user, body);
  }

  cancelBooking(user: CurrentUser, body: Row) {
    return this.service.cancelBooking(
      user,
      asInt(body.id, 0),
      asText(body.note),
    );
  }
}

export class MailTemplateController {
  constructor(private readonly service: MailTemplateService) {}

  templates(user: CurrentUser, query: Row) {
    return this.service.templates(user, query);
  }

  template(user: CurrentUser, id: string) {
    return this.service.template(user, id);
  }

  saveTemplate(user: CurrentUser, body: Row) {
    return this.service.saveTemplate(user, body);
  }

  removeTemplate(user: CurrentUser, body: Row) {
    return this.service.removeTemplate(user, asInt(body.id, 0));
  }

  previewTemplate(user: CurrentUser, body: Row) {
    return this.service.preview(user, body);
  }

  sendTest(user: CurrentUser, body: Row) {
    return this.service.sendTest(user, body);
  }
}

export class AssistantController {
  constructor(private readonly service: PageAssistantService) {}

  ask(user: CurrentUser, body: Row) {
    return this.service.ask(user, body);
  }

  history(user: CurrentUser, query: Row) {
    return this.service.history(user, query);
  }

  registry() {
    return this.service.registry();
  }
}

export class TranscriptionController {
  constructor(private readonly service: TranscriptionService) {}

  transcripts(user: CurrentUser, query: Row) {
    return this.service.transcripts(user, query);
  }

  create(user: CurrentUser, body: Row) {
    return this.service.create(user, body);
  }

  transcript(user: CurrentUser, id: string) {
    return this.service.transcript(user, id);
  }

  summarize(user: CurrentUser, id: string, body: Row) {
    return this.service.summarize(user, id, body);
  }

  applyInterviewDraft(user: CurrentUser, id: string, body: Row) {
    return this.service.applyInterviewDraft(user, id, body);
  }

  remove(user: CurrentUser, id: string) {
    return this.service.remove(user, id);
  }
}

export class QuotationDocumentController {
  constructor(private readonly service: QuotationDocumentService) {}

  document(user: CurrentUser, id: string) {
    return this.service.document(user, id);
  }

  send(user: CurrentUser, id: string, body: Row) {
    return this.service.send(user, id, body);
  }

  tracking(user: CurrentUser, query: Row) {
    return this.service.tracking(user, query);
  }
}

export class TimeAuditController {
  constructor(private readonly service: TimeAuditService) {}

  edits(user: CurrentUser, query: Row) {
    return this.service.edits(user, query);
  }

  summary(user: CurrentUser, query: Row) {
    return this.service.summary(user, query);
  }
}

export class PromoController {
  constructor(private readonly service: PromoService) {}

  promoCodes(user: CurrentUser) {
    return this.service.promoCodes(user);
  }

  savePromoCode(user: CurrentUser, body: Row) {
    return this.service.savePromoCode(user, body);
  }

  removePromoCode(user: CurrentUser, body: Row) {
    return this.service.removePromoCode(user, asInt(body.id, 0));
  }

  redeem(user: CurrentUser, body: Row) {
    return this.service.redeem(user, body);
  }
}

export class AfterSalesController {
  constructor(private readonly service: AfterSalesService) {}

  tickets(user: CurrentUser, query: Row) {
    return this.service.tickets(user, query);
  }

  ticket(user: CurrentUser, id: string) {
    return this.service.ticket(user, id);
  }

  saveTicket(user: CurrentUser, body: Row) {
    return this.service.saveTicket(user, body);
  }

  advance(user: CurrentUser, id: string, body: Row) {
    return this.service.advance(user, id, body);
  }
}

export class ReviewController {
  constructor(private readonly service: ReviewService) {}

  reviews(user: CurrentUser, query: Row) {
    return this.service.reviews(user, query);
  }

  saveReview(user: CurrentUser, body: Row) {
    return this.service.saveReview(user, body);
  }

  removeReview(user: CurrentUser, body: Row) {
    return this.service.removeReview(user, asInt(body.id, 0));
  }

  summary(user: CurrentUser, query: Row) {
    return this.service.summary(user, query);
  }
}

export class TaskSyncController {
  constructor(private readonly service: TaskSyncService) {}

  bindings(user: CurrentUser, query: Row) {
    return this.service.bindings(user, query);
  }

  saveBinding(user: CurrentUser, body: Row) {
    return this.service.saveBinding(user, body);
  }

  removeBinding(user: CurrentUser, body: Row) {
    return this.service.removeBinding(user, body);
  }

  run(user: CurrentUser, id: string, body: Row) {
    return this.service.run(user, asInt(id, 0), body);
  }

  runs(user: CurrentUser, id: string, query: Row) {
    return this.service.runs(user, asInt(id, 0), query);
  }

  links(user: CurrentUser, id: string, query: Row) {
    return this.service.links(user, asInt(id, 0), query);
  }
}

export class TermsController {
  constructor(private readonly service: TermsService) {}

  documents(user: CurrentUser, query: Row) {
    return this.service.documents(user, query);
  }

  saveDocument(user: CurrentUser, body: Row) {
    return this.service.saveDocument(user, body);
  }

  removeDocument(user: CurrentUser, body: Row) {
    return this.service.removeDocument(user, asInt(body.id, 0));
  }

  accept(
    user: CurrentUser,
    body: Row,
    meta: { ip?: string; userAgent?: string } = {},
  ) {
    return this.service.accept(user, body, meta);
  }

  my(user: CurrentUser) {
    return this.service.my(user);
  }

  pending(user: CurrentUser) {
    return this.service.pending(user);
  }
}

export class OnboardingController {
  constructor(private readonly service: OnboardingService) {}

  templates(user: CurrentUser) {
    return this.service.templates(user);
  }

  saveTemplate(user: CurrentUser, body: Row) {
    return this.service.saveTemplate(user, body);
  }

  removeTemplate(user: CurrentUser, body: Row) {
    return this.service.removeTemplate(user, asInt(body.id, 0));
  }

  runs(user: CurrentUser, query: Row) {
    return this.service.runs(user, query);
  }

  run(user: CurrentUser, id: string) {
    return this.service.run(user, id);
  }

  startRun(user: CurrentUser, body: Row) {
    return this.service.startRun(user, body);
  }

  completeTask(user: CurrentUser, taskId: string, body: Row) {
    return this.service.completeTask(user, taskId, body);
  }
}

export class ChangelogController {
  constructor(private readonly service: ChangelogService) {}

  entries(user: CurrentUser, query: Row) {
    return this.service.entries(user, query);
  }

  save(user: CurrentUser, body: Row) {
    return this.service.save(user, body);
  }

  remove(user: CurrentUser, body: Row) {
    return this.service.remove(user, asInt(body.id, 0));
  }
}

export class OrgContextController {
  constructor(private readonly service: OrgContextService) {}

  contexts(user: CurrentUser) {
    return this.service.contexts(user);
  }

  switch(user: CurrentUser, body: Row) {
    return this.service.switch(user, body);
  }
}

export class UsageController {
  constructor(private readonly service: UsageService) {}

  track(user: CurrentUser, body: Row, meta: { ip?: string } = {}) {
    return this.service.track(user, body, meta);
  }

  events(user: CurrentUser, query: Row) {
    return this.service.events(user, query);
  }

  summary(user: CurrentUser, query: Row) {
    return this.service.summary(user, query);
  }

  settings() {
    return this.service.settings();
  }

  saveSettings(user: CurrentUser, body: Row) {
    return this.service.saveSettings(user, body);
  }
}
