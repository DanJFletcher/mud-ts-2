import type { useCommerceController } from "../features/commerce/use-commerce-controller.js";

export interface MerchantPanelProps {
  activeMerchantCatalog: NonNullable<ReturnType<typeof useCommerceController>["activeMerchantCatalog"]>;
  closeMerchant: () => void;
  pending: string | null;
  purchaseMerchantListing: (listingId: string, recordCommand?: boolean) => Promise<void>;
}
export function MerchantPanel({ activeMerchantCatalog, closeMerchant, pending, purchaseMerchantListing }: MerchantPanelProps) {

  return (<section className="focused-merchant-catalog" aria-label={`${activeMerchantCatalog.merchantName} shop catalog`}>
    <div className="focused-merchant-catalog__header">
      <div>
        <strong>{activeMerchantCatalog.merchantName}</strong>
        <span>
          Balance: {activeMerchantCatalog.currency.balance} {activeMerchantCatalog.currency.name}
        </span>
      </div>
      <button
        type="button"
        className="focused-merchant-catalog__close"
        onClick={closeMerchant}
        aria-label="Close merchant catalog"
        disabled={pending !== null}
      >
        ×
      </button>
    </div>
    <div className="focused-merchant-catalog__list">
      {activeMerchantCatalog.listings.map((listing) => {
        const cannotAfford = activeMerchantCatalog.currency.balance < listing.price;
        return (
          <article className="focused-merchant-catalog__item" key={listing.id}>
            <div>
              <strong>{listing.item.label}</strong>
              <span>{listing.item.description}</span>
            </div>
            <button
              type="button"
              className="focused-quick-command"
              onClick={() => void purchaseMerchantListing(listing.id, true)}
              disabled={pending !== null || listing.purchased || cannotAfford}
              aria-label={`${listing.purchased ? "Purchased" : cannotAfford ? "Cannot afford" : "Buy"} ${listing.item.label} for ${listing.price} ${activeMerchantCatalog.currency.name}`}
            >
              {listing.purchased
                ? "Bought"
                : `${listing.price} ${activeMerchantCatalog.currency.symbol}`}
            </button>
          </article>
        );
      })}
    </div>
  </section>);
}
