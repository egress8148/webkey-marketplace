export const webkeyDao2MarketplaceAbi = [
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "_dao2Token",
          "type": "address"
        },
        {
          "internalType": "address",
          "name": "_treasury",
          "type": "address"
        },
        {
          "internalType": "address",
          "name": "_adminSigner",
          "type": "address"
        }
      ],
      "stateMutability": "nonpayable",
      "type": "constructor"
    },
    {
      "inputs": [],
      "name": "Dao2PriceNotSet",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "InsufficientStock",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "InvalidAddress",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "InvalidFee",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "InvalidPrice",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "InvalidQuantity",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "InvalidStock",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "ListingNotApproved",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "ListingNotFound",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "NotEligibleSeller",
      "type": "error"
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "owner",
          "type": "address"
        }
      ],
      "name": "OwnableInvalidOwner",
      "type": "error"
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "account",
          "type": "address"
        }
      ],
      "name": "OwnableUnauthorizedAccount",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "PaymentTransferFailed",
      "type": "error"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": true,
          "internalType": "address",
          "name": "newAdminSigner",
          "type": "address"
        }
      ],
      "name": "AdminSignerUpdated",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": false,
          "internalType": "uint256",
          "name": "newDao2PriceUsdt6",
          "type": "uint256"
        }
      ],
      "name": "Dao2PriceUpdated",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": true,
          "internalType": "address",
          "name": "newEligibilityContract",
          "type": "address"
        }
      ],
      "name": "EligibilityContractUpdated",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": false,
          "internalType": "bool",
          "name": "enabled",
          "type": "bool"
        }
      ],
      "name": "EligibilityModeUpdated",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": false,
          "internalType": "uint96",
          "name": "newFeeBps",
          "type": "uint96"
        }
      ],
      "name": "FeeUpdated",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": true,
          "internalType": "uint256",
          "name": "listingId",
          "type": "uint256"
        },
        {
          "indexed": true,
          "internalType": "address",
          "name": "seller",
          "type": "address"
        },
        {
          "indexed": false,
          "internalType": "string",
          "name": "title",
          "type": "string"
        },
        {
          "indexed": false,
          "internalType": "uint256",
          "name": "priceUsdt6",
          "type": "uint256"
        },
        {
          "indexed": false,
          "internalType": "uint256",
          "name": "stock",
          "type": "uint256"
        }
      ],
      "name": "ListingCreated",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": true,
          "internalType": "uint256",
          "name": "listingId",
          "type": "uint256"
        },
        {
          "indexed": true,
          "internalType": "address",
          "name": "buyer",
          "type": "address"
        },
        {
          "indexed": true,
          "internalType": "address",
          "name": "seller",
          "type": "address"
        },
        {
          "indexed": false,
          "internalType": "uint256",
          "name": "quantity",
          "type": "uint256"
        },
        {
          "indexed": false,
          "internalType": "uint256",
          "name": "totalDao2Amount",
          "type": "uint256"
        },
        {
          "indexed": false,
          "internalType": "uint256",
          "name": "sellerAmount",
          "type": "uint256"
        },
        {
          "indexed": false,
          "internalType": "uint256",
          "name": "platformFee",
          "type": "uint256"
        }
      ],
      "name": "ListingPurchased",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": true,
          "internalType": "uint256",
          "name": "listingId",
          "type": "uint256"
        },
        {
          "indexed": false,
          "internalType": "enum WebKeyDao2Marketplace.ListingStatus",
          "name": "status",
          "type": "uint8"
        }
      ],
      "name": "ListingStatusUpdated",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": true,
          "internalType": "address",
          "name": "previousOwner",
          "type": "address"
        },
        {
          "indexed": true,
          "internalType": "address",
          "name": "newOwner",
          "type": "address"
        }
      ],
      "name": "OwnershipTransferred",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": true,
          "internalType": "address",
          "name": "seller",
          "type": "address"
        },
        {
          "indexed": false,
          "internalType": "bool",
          "name": "approved",
          "type": "bool"
        }
      ],
      "name": "SellerApprovalUpdated",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": true,
          "internalType": "address",
          "name": "newTreasury",
          "type": "address"
        }
      ],
      "name": "TreasuryUpdated",
      "type": "event"
    },
    {
      "inputs": [],
      "name": "DAO2_DECIMALS",
      "outputs": [
        {
          "internalType": "uint8",
          "name": "",
          "type": "uint8"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "adminSigner",
      "outputs": [
        {
          "internalType": "address",
          "name": "",
          "type": "address"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "",
          "type": "address"
        }
      ],
      "name": "allowedSellers",
      "outputs": [
        {
          "internalType": "bool",
          "name": "",
          "type": "bool"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "listingId",
          "type": "uint256"
        },
        {
          "internalType": "bool",
          "name": "approved",
          "type": "bool"
        }
      ],
      "name": "approveListing",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "seller",
          "type": "address"
        },
        {
          "internalType": "bool",
          "name": "approved",
          "type": "bool"
        }
      ],
      "name": "authorizeSeller",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "listingId",
          "type": "uint256"
        },
        {
          "internalType": "uint256",
          "name": "quantity",
          "type": "uint256"
        }
      ],
      "name": "buyListing",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "user",
          "type": "address"
        }
      ],
      "name": "canSell",
      "outputs": [
        {
          "internalType": "bool",
          "name": "",
          "type": "bool"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "string",
          "name": "title",
          "type": "string"
        },
        {
          "internalType": "string",
          "name": "metadataURI",
          "type": "string"
        },
        {
          "internalType": "uint256",
          "name": "priceUsdt6",
          "type": "uint256"
        },
        {
          "internalType": "uint256",
          "name": "stock",
          "type": "uint256"
        }
      ],
      "name": "createListing",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "listingId",
          "type": "uint256"
        }
      ],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "dao2PriceUsdt6",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "dao2Token",
      "outputs": [
        {
          "internalType": "contract IERC20",
          "name": "",
          "type": "address"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "eligibilityContract",
      "outputs": [
        {
          "internalType": "address",
          "name": "",
          "type": "address"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "feeBps",
      "outputs": [
        {
          "internalType": "uint96",
          "name": "",
          "type": "uint96"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "listingId",
          "type": "uint256"
        }
      ],
      "name": "getListing",
      "outputs": [
        {
          "components": [
            {
              "internalType": "uint256",
              "name": "id",
              "type": "uint256"
            },
            {
              "internalType": "address",
              "name": "seller",
              "type": "address"
            },
            {
              "internalType": "string",
              "name": "title",
              "type": "string"
            },
            {
              "internalType": "string",
              "name": "metadataURI",
              "type": "string"
            },
            {
              "internalType": "uint256",
              "name": "priceUsdt6",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "stock",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "soldCount",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "grossSalesDao2",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "sellerRevenueDao2",
              "type": "uint256"
            },
            {
              "internalType": "enum WebKeyDao2Marketplace.ListingStatus",
              "name": "status",
              "type": "uint8"
            }
          ],
          "internalType": "struct WebKeyDao2Marketplace.Listing",
          "name": "",
          "type": "tuple"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "seller",
          "type": "address"
        }
      ],
      "name": "getSellerListingIds",
      "outputs": [
        {
          "internalType": "uint256[]",
          "name": "",
          "type": "uint256[]"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "seller",
          "type": "address"
        }
      ],
      "name": "getSellerStats",
      "outputs": [
        {
          "components": [
            {
              "internalType": "uint256",
              "name": "totalListings",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "pendingListings",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "approvedListings",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "rejectedListings",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "pausedListings",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "soldOutListings",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "soldUnits",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "grossSalesDao2",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "sellerRevenueDao2",
              "type": "uint256"
            }
          ],
          "internalType": "struct WebKeyDao2Marketplace.SellerStats",
          "name": "",
          "type": "tuple"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        }
      ],
      "name": "listings",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "id",
          "type": "uint256"
        },
        {
          "internalType": "address",
          "name": "seller",
          "type": "address"
        },
        {
          "internalType": "string",
          "name": "title",
          "type": "string"
        },
        {
          "internalType": "string",
          "name": "metadataURI",
          "type": "string"
        },
        {
          "internalType": "uint256",
          "name": "priceUsdt6",
          "type": "uint256"
        },
        {
          "internalType": "uint256",
          "name": "stock",
          "type": "uint256"
        },
        {
          "internalType": "uint256",
          "name": "soldCount",
          "type": "uint256"
        },
        {
          "internalType": "uint256",
          "name": "grossSalesDao2",
          "type": "uint256"
        },
        {
          "internalType": "uint256",
          "name": "sellerRevenueDao2",
          "type": "uint256"
        },
        {
          "internalType": "enum WebKeyDao2Marketplace.ListingStatus",
          "name": "status",
          "type": "uint8"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "nextListingId",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "owner",
      "outputs": [
        {
          "internalType": "address",
          "name": "",
          "type": "address"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "listingId",
          "type": "uint256"
        }
      ],
      "name": "pauseListing",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "platformRevenueDao2",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "priceUsdt6",
          "type": "uint256"
        },
        {
          "internalType": "uint256",
          "name": "quantity",
          "type": "uint256"
        }
      ],
      "name": "quoteDao2Amount",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "renounceOwnership",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "",
          "type": "address"
        },
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        }
      ],
      "name": "sellerListingIds",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "",
          "type": "address"
        }
      ],
      "name": "sellerStats",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "totalListings",
          "type": "uint256"
        },
        {
          "internalType": "uint256",
          "name": "pendingListings",
          "type": "uint256"
        },
        {
          "internalType": "uint256",
          "name": "approvedListings",
          "type": "uint256"
        },
        {
          "internalType": "uint256",
          "name": "rejectedListings",
          "type": "uint256"
        },
        {
          "internalType": "uint256",
          "name": "pausedListings",
          "type": "uint256"
        },
        {
          "internalType": "uint256",
          "name": "soldOutListings",
          "type": "uint256"
        },
        {
          "internalType": "uint256",
          "name": "soldUnits",
          "type": "uint256"
        },
        {
          "internalType": "uint256",
          "name": "grossSalesDao2",
          "type": "uint256"
        },
        {
          "internalType": "uint256",
          "name": "sellerRevenueDao2",
          "type": "uint256"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "newDao2PriceUsdt6",
          "type": "uint256"
        }
      ],
      "name": "setDao2PriceUsdt6",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "newEligibilityContract",
          "type": "address"
        }
      ],
      "name": "setEligibilityContract",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint96",
          "name": "newFeeBps",
          "type": "uint96"
        }
      ],
      "name": "setFeeBps",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "bool",
          "name": "enabled",
          "type": "bool"
        }
      ],
      "name": "setUseEligibilityContract",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "totalGrossSalesDao2",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "totalSoldUnits",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "newOwner",
          "type": "address"
        }
      ],
      "name": "transferOwnership",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "treasury",
      "outputs": [
        {
          "internalType": "address",
          "name": "",
          "type": "address"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "newAdminSigner",
          "type": "address"
        }
      ],
      "name": "updateAdminSigner",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "newTreasury",
          "type": "address"
        }
      ],
      "name": "updateTreasury",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "useEligibilityContract",
      "outputs": [
        {
          "internalType": "bool",
          "name": "",
          "type": "bool"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    }
  ]