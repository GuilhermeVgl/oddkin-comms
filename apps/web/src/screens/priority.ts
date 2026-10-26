import type { WorkItem } from "@crewstead/api-client";
import type { IconName } from "../design/icons";

export const PRIORITY_ICON: Record<WorkItem["priority"], IconName> = {
  low: "pBaixa",
  normal: "pNormal",
  high: "pAlta",
  urgent: "pUrgente",
};

export const PRIORITY_LABEL: Record<WorkItem["priority"], string> = {
  low: "Baixa",
  normal: "Normal",
  high: "Alta",
  urgent: "Urgente",
};
