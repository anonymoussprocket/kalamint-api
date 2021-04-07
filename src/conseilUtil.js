const conseiljs = require('conseiljs');
const fetch = require('node-fetch');
const log = require('loglevel');
const BigNumber = require('bignumber.js');

const logger = log.getLogger('conseiljs')
logger.setLevel('debug', false)
conseiljs.registerLogger(logger)
conseiljs.registerFetch(fetch)

const mainnetConfig = require('./config').platform.mainnet;
const conseilConfig = { url: mainnetConfig.nautilus.conseilServer, apiKey: mainnetConfig.nautilus.conseilApiKey, network: 'mainnet' };

/**
 * 
 * @param {string} address 
 * @returns 
 */
const getCollectionForAddress = async (address) => {
    let collectionQuery = conseiljs.ConseilQueryBuilder.blankQuery();
    collectionQuery = conseiljs.ConseilQueryBuilder.addFields(collectionQuery, 'key', 'value');
    collectionQuery = conseiljs.ConseilQueryBuilder.addPredicate(collectionQuery, 'big_map_id', conseiljs.ConseilOperator.EQ, [mainnetConfig.ledgerMap]);
    collectionQuery = conseiljs.ConseilQueryBuilder.addPredicate(collectionQuery, 'key', conseiljs.ConseilOperator.STARTSWITH, [
        `Pair 0x${conseiljs.TezosMessageUtils.writeAddress(address)}`,
    ]);
    collectionQuery = conseiljs.ConseilQueryBuilder.addPredicate(collectionQuery, 'value', conseiljs.ConseilOperator.EQ, [0], true);
    collectionQuery = conseiljs.ConseilQueryBuilder.setLimit(collectionQuery, 10_000);

    const collectionResult = await conseiljs.TezosConseilClient.getTezosEntityData(conseilConfig, conseilConfig.network, 'big_map_contents', collectionQuery);

    let collection = collectionResult.map((i) => {
        return {
            piece: i['key'].toString().replace(/.* ([0-9]{1,}$)/, '$1'),
            amount: Number(i['value'])
        }
    });

    const queryChunks = chunkArray(collection.map(i => i.piece), 50);
    const makeObjectQuery = (keys) => {
        let objectsQuery = conseiljs.ConseilQueryBuilder.blankQuery();
        objectsQuery = conseiljs.ConseilQueryBuilder.addFields(objectsQuery, 'key', 'key_hash', 'value');
        objectsQuery = conseiljs.ConseilQueryBuilder.addPredicate(objectsQuery, 'big_map_id', conseiljs.ConseilOperator.EQ, [mainnetConfig.tokenMap]);
        objectsQuery = conseiljs.ConseilQueryBuilder.addPredicate(objectsQuery, 'key', (keys.length > 1 ? conseiljs.ConseilOperator.IN : conseiljs.ConseilOperator.EQ), keys);
        objectsQuery = conseiljs.ConseilQueryBuilder.setLimit(objectsQuery, keys.length);

        return objectsQuery;
    };

    const objectDetailsPattern = new RegExp('[{] [0-9]+ ; [{] (.*) [}] ; [0-9]+ ; ([0-9]+) ; "ipfs:\\\\/\\\\/([a-zA-Z0-9]+)" ; 0x([0-9a-z]+) ; ([TrueFals]+) ; ([TrueFals]+) ; ([0-9]+) ; 0x([0-9a-z]+) ; ([0-9]+) ; ([0-9]+) ; ([0-9]+) [}]');
    const objectQueries = queryChunks.map(c => makeObjectQuery(c));
    const objectDetailsMap = {};
    await Promise.all(objectQueries.map(async (q) => await conseiljs.TezosConseilClient.getTezosEntityData(conseilConfig, conseilConfig.network, 'big_map_contents', q)
        .then(result => result.map(row => {
            const objectId = parseInt(row['key'].toString());

            const match = objectDetailsPattern.exec(row['value']);
            if (!match) {
                console.log(`NFT ${objectId} at ${row['key_hash']} did not match the expression: ${row['value']}`)
                return;
            }

            const extras = match[1].split(';')
                .map(s => s.trim().replace(/^Elt /, '')).map(s => s.replace(/"/g, ''))
                .map(s => {
                    const i = s.indexOf(' ');
                    const key = s.substring(0, i);
                    const value = s.substring(i).split(',').map(s => s.trim());
                    return { [key]: value } })
                .reduce((a, c) => {
                    const values = Object.values(c)[0];
                    a[Object.keys(c)[0]] = values.length === 1 ? values[0] : values;
                    return a }, {});

            objectDetailsMap[objectId] = {
                extras,
                price: match[2], // TODO: use bignumber to parse the price maybe
                ipfsItemHash: match[3],
                owner: conseiljs.TezosMessageUtils.readAddress(match[4]),
                onSale: match[5],
                onAuction: match[6],
                collection: match[7],
                creator: conseiljs.TezosMessageUtils.readAddress(match[8]),
                royalty: match[9],
                editionIndex: match[10],
                editionSize: match[11]
            }
    }))));

    const makeMetadataQuery = (keys) => {
        let objectsQuery = conseiljs.ConseilQueryBuilder.blankQuery();
        objectsQuery = conseiljs.ConseilQueryBuilder.addFields(objectsQuery, 'key', 'key_hash', 'value');
        objectsQuery = conseiljs.ConseilQueryBuilder.addPredicate(objectsQuery, 'big_map_id', conseiljs.ConseilOperator.EQ, [mainnetConfig.metadataMap]);
        objectsQuery = conseiljs.ConseilQueryBuilder.addPredicate(objectsQuery, 'key', (keys.length > 1 ? conseiljs.ConseilOperator.IN : conseiljs.ConseilOperator.EQ), keys);
        objectsQuery = conseiljs.ConseilQueryBuilder.setLimit(objectsQuery, keys.length);

        return objectsQuery;
    };
    
    const objectMetadataPattern = new RegExp('^Pair [0-9]+ [{] Elt "" 0x([0-9a-z]+) ;');
    const metadataQueries = queryChunks.map(c => makeMetadataQuery(c));
    const objectMetadataMap = {};
    await Promise.all(metadataQueries.map(async (q) => await conseiljs.TezosConseilClient.getTezosEntityData(conseilConfig, conseilConfig.network, 'big_map_contents', q)
        .then(result => result.map(row => {
            const objectId = parseInt(row['key'].toString());

            const match = objectMetadataPattern.exec(row['value']);
            if (!match) {
                console.log(`NFT ${objectId} at ${row['key_hash']} did not match the expression: ${row['value']}`);
                return;
            }

            objectMetadataMap[objectId] = { ipfsMetadataHash: Buffer.from(match[1], 'hex').toString().slice(7) };
    }))));

    collection = collection.map(i => {
        try {
            return { ...i, ...objectDetailsMap[i.piece], ...objectMetadataMap[i.piece] }
        } catch {
            return {...i}
        }
    });

    return collection;
}

const chunkArray = (arr, len) => {
    let chunks = [],
        i = 0,
        n = arr.length;

    while (i < n) {
        chunks.push(arr.slice(i, i += len));
    }

    return chunks;
}

module.exports = {
    getCollectionForAddress
}
