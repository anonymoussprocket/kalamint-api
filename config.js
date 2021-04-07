const platform = {
    edonet: {
        //
    },
    mainnet: {
        nautilus: { // signup at nautilus.cloud
            conseilServer: 'https://conseil-prod.cryptonomic-infra.tech',
            conseilApiKey: '',
            tezosNode: '',
        },
        coreContract: 'KT1EpGgjQs73QfFJs9z7m1Mxm5MTnpC2tqse',
        tokenMap: 861,
        metadataMap: 860,
        ledgerMap: 857
    }
}

module.exports = { platform }
