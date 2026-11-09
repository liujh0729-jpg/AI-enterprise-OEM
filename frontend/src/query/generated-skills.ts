"use client";
import { generatedSkillApi } from "@/api/generated-skills";
import { useBusinessQuery } from "./business";

export const useGeneratedSkills = () =>
  useBusinessQuery("developer", "generated-skills", {}, (signal) =>
    generatedSkillApi.list({}, { signal }),
  );
