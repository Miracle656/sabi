// Where a memory id (Walrus blob id) can be inspected. Both URL shapes are
// documented Walrus surfaces:
//  - the public aggregator HTTP API: GET /v1/blobs/{blob_id}
//    (returns the raw blob - Seal-encrypted bytes, which is itself the proof that
//    the relayer never stored plaintext on Walrus)
//  - Walruscan, the block explorer for Walrus blobs

export type Network = "mainnet" | "testnet";

export function aggregatorUrl(blobId: string, network: Network): string {
  return `https://aggregator.walrus-${network}.walrus.space/v1/blobs/${encodeURIComponent(blobId)}`;
}

export function walruscanUrl(blobId: string, network: Network): string {
  return `https://walruscan.com/${network}/blob/${encodeURIComponent(blobId)}`;
}
