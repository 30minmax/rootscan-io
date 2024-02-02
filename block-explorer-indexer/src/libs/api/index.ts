import DB from '@/database';
import logger from '@/logger';
import { IAddress, IBalance, IEVMTransaction, IEvent, IExtrinsic, INFT, IStakingValidator, IToken, TTokenType } from '@/types';
import cors from 'cors';
import express, { Request, Response } from 'express';
import helmet from 'helmet';
import moment from 'moment';
import { Address, Hash, getAddress } from 'viem';
const app = express();

/** @dev Middlewares */
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cors('*'));
app.use(helmet());

const getDurationInMilliseconds = (start) => {
  const NS_PER_SEC = 1e9;
  const NS_TO_MS = 1e6;
  const diff = process.hrtime(start);

  return (diff[0] * NS_PER_SEC + diff[1]) / NS_TO_MS;
};

app.use((req, res, next) => {
  // logger.info(`${req.method} ${req.originalUrl} [STARTED]`);
  const start = process.hrtime();

  res.on('finish', () => {
    const durationInMilliseconds = getDurationInMilliseconds(start);
    logger.info(`[${req.method}] ${req.originalUrl} [${JSON.stringify(req.body)}] took ${durationInMilliseconds} ms`);
  });

  // res.on('close', () => {
  //   const durationInMilliseconds = getDurationInMilliseconds(start);
  //   logger.info(`${req.method} ${req.originalUrl} [CLOSED] ${durationInMilliseconds} ms`);
  // });

  next();
});

app.post('/getBlock', async (req: Request, res: Response) => {
  const { number }: { number: number } = req.body;
  const data = await DB.Block.findOne({ number: Number(number) }).lean();
  return res.json(data);
});

app.post('/getBlocks', async (req: Request, res: Response) => {
  try {
    const { page, limit }: { page: number; limit: number } = req.body;
    logger.info(`${new Date().toLocaleString()} getBlocks => ${page}, ${limit}`);
    const options = {
      page: page ? Number(page) : 1,
      limit: limit ? limit : 25,
      sort: '-number',
      skipFullCount: true,
      allowDiskUse: true,
      lean: true
    };
    const data = await DB.Block.paginate({}, options);
    return res.json(data);
  } catch (e) {
    console.log(e);
  }
});

app.post('/getEvents', async (req: Request, res: Response) => {
  try {
    const { page, limit, query }: { page: number; limit: number; query: object } = req.body;
    const options = {
      page: page ? Number(page) : 1,
      limit: limit ? limit : 25,
      sort: '-blockNumber',
      allowDiskUse: true,
      skipFullCount: true,
      lean: true
    };

    const data = await DB.Event.paginate(query ? query : {}, options);
    return res.json(data);
  } catch (e) {
    console.log(e);
  }
});

app.post('/getEvent', async (req: Request, res: Response) => {
  try {
    const { eventId }: { eventId: string } = req.body;
    const data = await DB.Event.findOne({ eventId: String(eventId) })
      .populate('token swapFromToken swapToToken nftCollection')
      .lean();
    return res.json(data);
  } catch (e) {
    console.log(e);
  }
});

app.post('/getExtrinsic', async (req: Request, res: Response) => {
  try {
    const { extrinsicId }: { extrinsicId: string } = req.body;
    const data: (IExtrinsic & { events?: IEvent[] }) | null = await DB.Extrinsic.findOne({
      $or: [{ extrinsicId: String(extrinsicId) }, { retroExtrinsicId: String(extrinsicId) }]
    })
      .populate('proxyFeeToken')
      .lean();

    const events = await DB.Event.find({ extrinsicId: String(extrinsicId) })
      .populate('token swapFromToken swapToToken nftCollection')
      .lean();

    if (data && events) {
      data.events = events;
    }
    return res.json(data);
  } catch (e) {
    console.log(e);
  }
});

app.post('/getToken', async (req: Request, res: Response) => {
  try {
    const { contractAddress }: { contractAddress: Address } = req.body;

    const data: (IToken & { holders?: number }) | null = await DB.Token.findOne({ contractAddress: getAddress(contractAddress) }).lean();

    if (data) {
      if (data?.type === 'ERC20') {
        const holders = await DB.Balance.find({ contractAddress: getAddress(contractAddress) }).countDocuments();
        data.holders = holders;
      } else if (data?.type === 'ERC721' || data?.type === 'ERC1155') {
        const holders = await DB.Nft.find({ contractAddress: getAddress(contractAddress) })
          .distinct('owner')
          .countDocuments();
        data.holders = holders;
      }
    }
    return res.json(data);
  } catch (e) {
    console.log(e);
  }
});

app.post('/getTokenHolders', async (req: Request, res: Response) => {
  try {
    const { contractAddress, page }: { contractAddress: Address; page: number } = req.body;

    const data: (IToken & { holders?: number }) | null = await DB.Token.findOne({ contractAddress: getAddress(contractAddress) }).lean();

    let holders: { docs?: (IBalance | INFT)[]; type?: TTokenType } = {};
    if (data) {
      if (data?.type === 'ERC20') {
        const options = {
          page: page ? Number(page) : 1,
          limit: 25,
          sort: '-balance',
          populate: 'tokenDetails',
          allowDiskUse: true,
          skipFullCount: true,
          lean: true
        };

        holders = await DB.Balance.paginate({ contractAddress: getAddress(contractAddress) }, options);
      } else if (data?.type === 'ERC721') {
        const options = {
          page: page ? Number(page) : 1,
          limit: 25
        };
        const pipeline = DB.Nft.aggregate([
          {
            $match: {
              contractAddress: getAddress(contractAddress)
            }
          },
          {
            $group: {
              _id: '$owner',
              count: {
                $sum: 1
              }
            }
          },
          {
            $sort: {
              count: -1
            }
          },
          {
            $project: {
              _id: 0,
              owner: '$_id',
              count: 1
            }
          }
        ]);
        // @ts-expect-error aggregatePipeline does exist
        holders = await DB.Nft.aggregatePaginate(pipeline, options);
      } else if (data?.type === 'ERC1155') {
        const options = {
          page: page ? Number(page) : 1,
          limit: 25
        };
        const pipeline = DB.Nft.aggregate([
          {
            $match: {
              contractAddress: getAddress(contractAddress)
            }
          },
          {
            $group: {
              _id: '$owner',
              count: {
                $sum: '$amount'
              }
            }
          },
          {
            $sort: {
              count: -1
            }
          },
          {
            $project: {
              _id: 0,
              owner: '$_id',
              count: 1
            }
          }
        ]);
        // @ts-expect-error aggregatePipeline does exist
        holders = await DB.Nft.aggregatePaginate(pipeline, options);
      }
      if (holders) {
        holders.type = data?.type as TTokenType;
      }
    }
    return res.json(holders);
  } catch (e) {
    console.log(e);
  }
});

app.post('/getExtrinsicsInBlock', async (req: Request, res: Response) => {
  try {
    const { number }: { number: number } = req.body;
    const data = await DB.Extrinsic.find({ block: Number(number) }).lean();
    return res.json(data);
  } catch (e) {
    console.log(e);
  }
});

app.post('/getExtrinsicsForAddress', async (req: Request, res: Response) => {
  try {
    const { page, limit, address }: { page: number; limit: number; address: Address } = req.body;
    const options = {
      page: page ? Number(page) : 1,
      limit: limit ? limit : 25,
      sort: '-block',
      paginate: false,
      skipFullCount: true,
      allowDiskUse: true,
      lean: true
    };

    const data = await DB.Extrinsic.paginate(
      { $or: [{ signer: getAddress(address) }, { 'args.futurepass': getAddress(address) }] },
      options
    );

    return res.json(data);
  } catch (e) {
    console.log(e);
  }
});

app.post('/getNftsForAddress', async (req: Request, res: Response) => {
  try {
    const { page, limit, address, contractAddress }: { page: number; limit: number; address: Address; contractAddress: Address } = req.body;
    const options = {
      page: page ? Number(page) : 1,
      limit: limit ? limit : 25,
      skipFullCount: true,
      allowDiskUse: true,
      sort: '-contractAddress',
      lean: true
    };
    const data = await DB.Nft.paginate({ owner: getAddress(address), contractAddress: getAddress(contractAddress) }, options);
    return res.json(data);
  } catch (e) {
    console.log(e);
  }
});

app.post('/getNftCollectionsForAddress', async (req: Request, res: Response) => {
  try {
    const { page, limit, address }: { page: number; limit: number; address: Address } = req.body;
    const options = {
      page: page ? Number(page) : 1,
      limit: limit ? limit : 25,
      allowDiskUse: true
    };

    const pipeline = DB.Nft.aggregate([
      {
        $match: {
          owner: getAddress(address)
        }
      },
      {
        $group: {
          _id: '$contractAddress',
          count: {
            $sum: 1
          }
        }
      },
      {
        $lookup: {
          from: 'tokens',
          localField: '_id',
          foreignField: 'contractAddress',
          as: 'tokenLookUp'
        }
      },
      {
        $project: {
          _id: 0,
          contractAddress: '$_id',
          count: 1,
          tokenLookUp: {
            $arrayElemAt: ['$tokenLookUp', 0]
          }
        }
      }
    ]);

    // @ts-expect-error aggregatePipeline does exist
    const data = await DB.Nft.aggregatePaginate(pipeline, options);

    return res.json(data);
  } catch (e) {
    console.log(e);
  }
});

app.post('/getTransactions', async (req: Request, res: Response) => {
  try {
    const { page, limit }: { page: number; limit: number } = req.body;
    const options = {
      page: page ? Number(page) : 1,
      limit: limit ? limit : 25,
      sort: '-blockNumber',
      populate: 'fromLookup toLookup',
      skipFullCount: true,
      allowDiskUse: true,
      lean: true
    };
    const data = await DB.EvmTransaction.paginate({}, options);
    return res.json(data);
  } catch (e) {
    console.log(e);
  }
});

app.post('/getTransactionsInBlock', async (req: Request, res: Response) => {
  try {
    const { page, limit, block }: { page: number; limit: number; block: number } = req.body;
    const options = {
      page: page ? Number(page) : 1,
      limit: limit ? limit : 25,
      sort: '-blockNumber',
      populate: 'fromLookup toLookup',
      allowDiskUse: true,
      skipFullCount: true,
      lean: true
    };
    const data = await DB.EvmTransaction.paginate({ blockNumber: block }, options);
    return res.json(data);
  } catch (e) {
    console.log(e);
  }
});

app.post('/getEVMTransactionsForWallet', async (req: Request, res: Response) => {
  try {
    const { page, limit, address }: { page: number; limit: number; address: Address } = req.body;
    const options = {
      page: page ? Number(page) : 1,
      limit: limit ? limit : 25,
      sort: '-blockNumber',
      populate: 'fromLookup toLookup',
      skipFullCount: true,
      allowDiskUse: true,
      lean: true
    };

    const data = await DB.EvmTransaction.paginate({ $or: [{ from: getAddress(address) }, { to: getAddress(address) }] }, options);

    return res.json(data);
  } catch (e) {
    console.log(e);
  }
});

app.post('/getNativeTransfersForAddress', async (req: Request, res: Response) => {
  try {
    const { page, limit, address }: { page: number; limit: number; address: Address } = req.body;
    const options = {
      page: page ? Number(page) : 1,
      limit: limit ? limit : 25,
      sort: '-blockNumber',
      skipFullCount: true,
      allowDiskUse: true,
      populate: 'extrinsicData token nftCollection',
      lean: true
    };

    const data = await DB.Event.paginate(
      {
        $or: [
          // Assets Pallet
          { section: 'assets', method: 'Transferred', 'args.from': getAddress(address) },
          { section: 'assets', method: 'Transferred', 'args.to': getAddress(address) },
          { section: 'assets', method: 'ApprovedTransfer', 'args.source': getAddress(address) },
          { section: 'assets', method: 'Issued', 'args.source': getAddress(address) },
          { section: 'assets', method: 'Issued', 'args.owner': getAddress(address) },
          { section: 'assets', method: 'Burned', 'args.owner': getAddress(address) },
          // Balances Pallet
          { section: 'balances', method: 'Reserved', 'args.who': getAddress(address) },
          { section: 'balances', method: 'Transfer', 'args.from': getAddress(address) },
          { section: 'balances', method: 'Transfer', 'args.to': getAddress(address) },
          { section: 'balances', method: 'Unreserved', 'args.who': getAddress(address) },
          // NFT Transfer
          { section: 'nft', method: 'Transfer', 'args.previousOwner': getAddress(address) },
          { section: 'nft', method: 'Transfer', 'args.newOwner': getAddress(address) },
          { section: 'nft', method: 'Mint', 'args.owner': getAddress(address) }
        ]
      },
      options
    );

    return res.json(data);
  } catch (e) {
    console.log(e);
  }
});

app.post('/getTokens', async (req: Request, res: Response) => {
  try {
    const { page, limit, type }: { page: number; limit: number; type?: string } = req.body;
    const options = {
      page: page ? Number(page) : 1,
      limit: limit ? limit : 25,
      allowDiskUse: true,
      skipFullCount: true,
      lean: true
    };
    const query: { type?: string } = {};
    if (type) {
      query.type = type;
    }
    const data = await DB.Token.paginate(query, options);
    return res.json(data);
  } catch (e) {
    console.log(e);
  }
});

app.post('/getExtrinsics', async (req: Request, res: Response) => {
  try {
    const { page, limit }: { page: number; limit: number } = req.body;
    const options = {
      page: page ? Number(page) : 1,
      limit: limit ? limit : 25,
      sort: '-block -timestamp',
      allowDiskUse: true,
      skipFullCount: true,
      lean: true
    };
    const data = await DB.Extrinsic.paginate({ section: { $ne: 'timestamp' }, method: { $ne: 'set' } }, options);
    return res.json(data);
  } catch (e) {
    console.log(e);
  }
});

app.post('/getTokenTransfersFromAddress', async (req: Request, res: Response) => {
  try {
    const { page, limit, address }: { page: number; limit: number; address: Address } = req.body;
    const options = {
      page: page ? Number(page) : 1,
      limit: limit ? limit : 25,
      sort: '-blockNumber',
      allowDiskUse: true
    };

    const pipeline = DB.EvmTransaction.aggregate([
      {
        $match: {
          'events.eventName': 'Transfer',
          $or: [
            {
              'events.from': getAddress(address)
            },
            {
              'events.to': getAddress(address)
            }
          ]
        }
      },
      {
        $project: {
          type: 0,
          accessList: 0,
          input: 0,
          from: 0,
          to: 0
        }
      },
      { $unwind: '$events' },
      {
        $match: {
          'events.eventName': 'Transfer',
          $or: [
            {
              'events.from': getAddress(address)
            },
            {
              'events.to': getAddress(address)
            }
          ]
        }
      },
      {
        $replaceRoot: {
          newRoot: {
            $mergeObjects: ['$events', '$$ROOT']
          }
        }
      }
    ]);

    // @ts-expect-error aggregatePipeline does exist
    const data = await DB.EvmTransaction.aggregatePaginate(pipeline, options);

    return res.json(data);
  } catch (e) {
    console.log(e);
  }
});

app.post('/getTransaction', async (req: Request, res: Response) => {
  const { hash }: { hash: Hash } = req.body;

  const data: (IEVMTransaction & { xrpPriceData?: object }) | null = await DB.EvmTransaction.findOne({ hash })
    .populate('fromLookup toLookup')
    .lean();
  const xrpPrice = await DB.Token.findOne({ contractAddress: '0xCCCCcCCc00000002000000000000000000000000' }).lean();

  if (data && xrpPrice?.priceData) {
    data.xrpPriceData = xrpPrice?.priceData;
  }
  return res.json(data);
});

app.post('/getNft', async (req: Request, res: Response) => {
  const { contractAddress, tokenId }: { contractAddress: Address; tokenId: number } = req.body;

  const data = await DB.Nft.findOne({ contractAddress: getAddress(contractAddress), tokenId: Number(tokenId) }).lean();
  return res.json(data);
});

app.post('/getAddress', async (req: Request, res: Response) => {
  const { address }: { address: Address } = req.body;
  const data: (IAddress & { rootPriceData?: object | null }) | null = await DB.Address.findOne({ address: getAddress(address) })
    .populate('isVerifiedContract')
    .lean();
  if (data?.balance?.freeFormatted) {
    const rootPriceData = await DB.Token.findOne({ contractAddress: getAddress('0xcCcCCccC00000001000000000000000000000000') })
      .select('priceData')
      .lean();
    data.rootPriceData = rootPriceData?.priceData;
  }
  return res.json(data);
});

app.post('/getTokenBalances', async (req: Request, res: Response) => {
  
  const { page, limit, address }: { page: number; limit: number; address: Address } = req.body;
  const options = {
    page: page ? Number(page) : 1,
    limit: limit ? limit : 25,
    allowDiskUse: true,
    populate: 'tokenDetails',
    lean: true
  };
  const data = await DB.Balance.paginate({ address: getAddress(address) }, options);

  return res.json(data);
});

app.post('/getAddresses', async (req: Request, res: Response) => {
  const { page, limit }: { page: number; limit: number } = req.body;
  const options = {
    page: page ? Number(page) : 1,
    limit: limit ? limit : 25,
    allowDiskUse: true,
    skipFullCount: true,
    sort: '-balance.free',
    lean: true
  };

  const data: { docs?: ({ xrpBalance?: number } & IAddress)[] } = await DB.Address.paginate({}, options);

  if (data?.docs) {
    const addresses = data?.docs?.map((a) => a.address);

    const xrpBalances: IBalance[] = await DB.Balance.find({
      address: { $in: addresses },
      contractAddress: '0xCCCCcCCc00000002000000000000000000000000'
    })
      .select('address balance')
      .lean();

    for (const record of data.docs) {
      const xrpBalance = xrpBalances.find((a) => a.address == record.address);
      if (xrpBalance) {
        record.xrpBalance = xrpBalance?.balance;
      }
    }
  }

  return res.json(data);
});

app.post('/getBridgeTransactions', async (req: Request, res: Response) => {
  const { page, limit, address }: { page: number; limit: number; address: Address } = req.body;
  const options = {
    page: page ? Number(page) : 1,
    limit: limit ? limit : 25,
    populate: 'xrplProcessingOk bridgeErc20Token bridgeErc721Token',
    allowDiskUse: true,
    skipFullCount: true,
    sort: '-block',
    lean: true
  };

  const genPartialKey = (key: string, isLowerCase: boolean) => {
    if (!address) return {};

    return { [key]: isLowerCase ? address.toLowerCase() : getAddress(address) };
  };

  const data = await DB.Extrinsic.paginate(
    {
      $or: [
        // {
        //   method: 'withdrawXrp',
        //   section: 'xrplBridge'
        // },
        {
          method: 'submitTransaction',
          section: 'xrplBridge',
          ...genPartialKey('args.transaction.payment.address', true)
        },
        {
          section: 'ethBridge',
          method: 'submitEvent',
          ...genPartialKey('args.to', false)
        }
      ]
    },
    options
  );

  return res.json(data);
});

app.post('/getVerifiedContracts', async (req: Request, res: Response) => {
  const { page, limit }: { page: number; limit: number } = req.body;
  const options = {
    page: page ? Number(page) : 1,
    limit: limit ? limit : 25,
    sort: '-deployedBlock',
    allowDiskUse: true,
    lean: true
  };

  const data = await DB.VerifiedContract.paginate({}, options);

  return res.json(data);
});

app.post('/getStakingValidators', async (req: Request, res: Response) => {
  const { page, limit }: { page: number; limit: number } = req.body;
  const options = {
    page: page ? Number(page) : 1,
    limit: limit ? limit : 25,
    allowDiskUse: true,
    sort: '-nominators',
    lean: true
  };

  const data: { docs: (IStakingValidator & { blocksValidated?: number })[] } = await DB.StakingValidator.paginate({}, options);

  const addresses = data?.docs?.map((a) => getAddress(a.validator));
  const aggPipe = await DB.Block.aggregate([
    {
      $match: {
        'evmBlock.miner': {
          $in: addresses
        },
        timestamp: {
          $gte: moment().subtract('1', 'days').milliseconds()
        }
      }
    },
    {
      $group: {
        _id: '$evmBlock.miner',
        count: {
          $sum: 1
        }
      }
    },
    {
      $project: {
        _id: 0,
        address: '$_id',
        count: 1
      }
    }
  ]);

  for (const address of data.docs) {
    const lookUp = aggPipe.find((a) => a.address === address.validator);
    if (lookUp) {
      address.blocksValidated = lookUp.count;
    }
  }
  return res.json(data);
});

app.post('/getDex', async (req: Request, res: Response) => {
  const { page, limit }: { page: number; limit: number } = req.body;
  const options = {
    page: page ? Number(page) : 1,
    limit: limit ? limit : 25,
    allowDiskUse: true,
    skipFullCount: true,
    sort: '-blockNumber',
    populate: 'swapFromToken swapToToken',
    lean: true
  };
  const data = await DB.Event.paginate(
    {
      $or: [
        {
          method: 'Swap',
          section: 'dex'
        }
      ]
    },
    options
  );

  return res.json(data);
});

app.post('/getRootPrice', async (req: Request, res: Response) => {
  const data = await DB.Token.findOne({ contractAddress: '0xcCcCCccC00000001000000000000000000000000' }).lean();
  return res.json(data?.priceData);
});

app.post('/getChainSummary', async (req: Request, res: Response) => {
  const addresses = await DB.Address.find().estimatedDocumentCount();
  const signedExtrinsics = await DB.Extrinsic.find({ isSigned: true }).estimatedDocumentCount();
  const evmTransactions = await DB.EvmTransaction.find().estimatedDocumentCount();
  return res.json({ addresses, signedExtrinsics, evmTransactions });
});

app.get('/getRequiredComponents', async (req: Request, res: Response) => {
  const events = await DB.Event.aggregate([
    {
      $group: {
        _id: '$section',
        methods: {
          $addToSet: '$method'
        }
      }
    }
  ]);
  const extrinsics = await DB.Extrinsic.aggregate([
    {
      $group: {
        _id: '$section',
        methods: {
          $addToSet: '$method'
        }
      }
    }
  ]);
  return res.json({ events, extrinsics });
});

app.get('/ready', async (req: Request, res: Response) => {
  return res.json({ ready: true });
});

app.listen(3001, () => {
  logger.info(`🚀`);
});