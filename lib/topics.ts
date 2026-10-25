// How each category reads as a topic: a plural label and one line on what
// lands there. Display only; the categories themselves live in findings.ts.

import type { Category } from "./findings";

export const TOPICS: Record<Category, { label: string; about: string }> = {
  CARRIER: {
    label: "Carriers",
    about: "Mobile networks and ISPs blocking, throttling or rewriting traffic.",
  },
  PAYMENTS: {
    label: "Payments",
    about: "Payment APIs, payouts and webhooks that behave differently from their docs.",
  },
  WALLET: {
    label: "Wallets",
    about: "Connecting, signing and zkLogin across wallets, browsers and devices.",
  },
  RPC: {
    label: "RPC",
    about: "Fullnodes and RPC providers: rate limits, keys, errors and outages.",
  },
  TOOLING: {
    label: "Tooling",
    about: "SDKs, CLIs and libraries: breaking versions, build errors, workarounds.",
  },
  REGULATORY: {
    label: "Regulatory",
    about: "KYC, licensing and policy requirements that change what you can ship.",
  },
  EXCHANGE: {
    label: "Exchanges",
    about: "On-ramps, off-ramps, deposits and withdrawals.",
  },
  INFRA: {
    label: "Infra",
    about: "Hosting, deploys, DNS, storage and indexers.",
  },
};
