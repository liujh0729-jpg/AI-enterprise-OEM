import { endpoints } from "@enterprise/contracts";
import { endpoint } from "./endpoint";

export const questionHallApi = {
  questions: endpoint(endpoints.QuestionHall_questions),
  detail: endpoint(endpoints.QuestionHall_questionDetail),
  create: endpoint(endpoints.QuestionHall_createQuestion),
  reply: endpoint(endpoints.QuestionHall_reply),
  resolve: endpoint(endpoints.QuestionHall_resolve),
  close: endpoint(endpoints.QuestionHall_close),
  reopen: endpoint(endpoints.QuestionHall_reopen),
  remove: endpoint(endpoints.QuestionHall_deleteQuestion),
  removeReply: endpoint(endpoints.QuestionHall_deleteReply),
  config: endpoint(endpoints.QuestionHall_config),
};