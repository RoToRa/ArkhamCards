import { chunk, filter, flatMap, forEach, groupBy, head, map, partition, sortBy, uniq, values } from 'lodash';
import { Alert, Platform } from 'react-native';
import { t } from 'ttag';

import { CardCache, TabooCache, Pack } from '@actions/types';
import { Rule as JsonRule } from '@data/scenario/types';
import Card from '@data/Card';
import Rule from '@data/Rule';
import Database from '@data/Database';
import TabooSet from '@data/TabooSet';
import FaqEntry from '@data/FaqEntry';

const VERBOSE = false;
export const syncTaboos = async function(
  db: Database,
  lang?: string,
  cache?: TabooCache
): Promise<TabooCache | null> {
  try {
    const langPrefix = lang && lang !== 'en' ? `${lang}.` : '';
    const uri = `https://${langPrefix}arkhamdb.com/api/public/taboos/`;
    const headers = new Headers();
    if (cache && cache.lastModified && cache.tabooCount > 0) {
      const cards = await db.cards();
      const tabooCount = await cards.createQueryBuilder()
        .where('taboo_set_id > 0')
        .getCount();
      if (tabooCount === cache.tabooCount) {
        headers.append('If-Modified-Since', cache.lastModified);
      }
    }
    const response = await fetch(uri, {
      method: 'GET',
      headers,
    });
    if (response.status === 304 && cache) {
      return cache;
    }
    const lastModified = response.headers.get('Last-Modified') || undefined;
    const json = await response.json();
    const allTabooCards = uniq(
      flatMap(json, tabooJson => {
        const cards = JSON.parse(tabooJson.cards);
        return map(cards, card => card.code);
      })
    );
    VERBOSE && console.log('Starting to update Taboos');
    const cardsRep = await db.cards();
    await cardsRep.createQueryBuilder().where('taboo_set_id > 0').delete().execute();
    VERBOSE && console.log('Deleted old Taboo cards');

    await cardsRep.createQueryBuilder()
      .update()
      .where('code in (:...codes) AND (taboo_set_id is null)', { codes: allTabooCards })
      .set({ taboo_set_id: 0 })
      .execute();
    VERBOSE && console.log('Found base taboo cards');
    let queryRunner = await db.startTransaction();
    const baseTabooCards: Card[] = flatMap(await Promise.all(map(allTabooCards, code => {
      return queryRunner.manager.createQueryBuilder(Card, 'c')
        .where('c.code = :code AND c.taboo_set_id = 0')
        .leftJoin('c.linked_card', 'linked_card')
        .setParameters({ code })
        .addSelect(Card.ELIDED_FIELDS)
        .getOne();
    })), x => x ? [x] : []);
    await queryRunner.commitTransaction();
    await queryRunner.release();

    const tabooSetsRep = await db.tabooSets();
    await tabooSetsRep.createQueryBuilder().delete().execute();

    queryRunner = await db.startTransaction();
    const tabooSets: TabooSet[] = [];
    for (let i = 0; i < json.length; i++) {
      const tabooJson = json[i];
      const cards = JSON.parse(tabooJson.cards);
      try {
        tabooSets.push(TabooSet.fromJson(tabooJson, cards.length));
        const tabooCardsToSave: {
          [key: string]: Card | undefined;
        } = {};
        forEach(baseTabooCards, card => {
          tabooCardsToSave[card.code] = Card.placeholderTabooCard(tabooJson.id, card);
        });

        for (let j = 0; j < cards.length; j++) {
          const cardJson = cards[j];
          const code: string = cardJson.code;
          const card = tabooCardsToSave[code];
          if (card) {
            try {
              tabooCardsToSave[code] = Card.fromTabooCardJson(tabooJson.id, cardJson, card);
            } catch (e) {
              Alert.alert(`${e}`);
              console.log(e);
            }
          } else {
            console.log(`Could not find old card: ${code}`);
          }
        }
        const cardsToInsert = flatMap(values(tabooCardsToSave), card => card ? [card] : []);
        // await cards.save(cardsToInsert);
        await insertChunk(cardsToInsert, async cards => {
          await queryRunner.manager.insert(Card, cards);
        }, 4);
      } catch (e) {
        console.log(e);
        Alert.alert(`${e}`);
      }
    }
    await queryRunner.commitTransaction();
    await queryRunner.release();

    await tabooSetsRep.insert(tabooSets);
    const tabooCount = await cardsRep.createQueryBuilder()
      .where('taboo_set_id > 0')
      .getCount();
    return {
      tabooCount,
      lastModified,
    };
  } catch (e) {
    console.log(e);
    throw e;
  }
};

async function insertChunk<T>(things: T[], insert: (things: T[]) => Promise<any>, maxInsert?: number) {
  const chunkThings = chunk(things, Platform.OS === 'ios' ? 50 : maxInsert || 8);
  await Promise.all(map(chunkThings, async toInsert => await insert(toInsert)));
}

function rulesJson(lang?: string) {
  switch (lang) {
    case 'es':
      return require('../../assets/rules_es.json');
    case 'ru':
      return require('../../assets/rules_ru.json');
    case 'de':
      return require('../../assets/rules_de.json');
    case 'en':
    default:
      return require('../../assets/rules.json');
  }
}

export const syncRules = async function(
  db: Database,
  lang?: string
): Promise<void> {
  const rules: JsonRule[] = rulesJson(lang);
  const allRules = flatMap(rules, (jsonRule, index) => {
    const rule = Rule.parse(lang || 'en', jsonRule, index);
    return [rule];
  });

  const [simpleRules, complexRules] = partition(allRules, r => !r.rules);
  await insertChunk(simpleRules, async rules => await db.insertRules(rules));
  forEach(complexRules, r => {
    db.insertRules([
      r,
      ...flatMap(r.rules || [], r2 => [r2, ...(r2.rules || [])]),
    ]);
  });
};

export const syncCards = async function(
  db: Database,
  packs: Pack[],
  lang?: string,
  cache?: CardCache
): Promise<CardCache | null> {
  VERBOSE && console.log('syncCards called');
  try {
    VERBOSE && console.log('Starting sync of cards from ArkhamDB');
    const langPrefix = lang && lang !== 'en' ? `${lang}.` : '';
    const uri = `https://${langPrefix}arkhamdb.com/api/public/cards/?encounter=1`;
    const packsByCode: { [code: string]: Pack } = {};
    const cycleNames: {
      [cycle_position: number]: {
        name?: string;
        code?: string;
      };
    } = {};
    forEach(packs, pack => {
      packsByCode[pack.code] = pack;
      if (pack.position === 1) {
        cycleNames[pack.cycle_position] = pack;
      }
    });
    cycleNames[50] = {};
    cycleNames[60] = {};
    cycleNames[70] = {};
    cycleNames[80] = {};
    cycleNames[90] = {};
    const headers = new Headers();
    if (cache &&
      cache.lastModified &&
      cache.cardCount > 0
    ) {
      const cards = await db.cards();
      const cardCount = await cards.createQueryBuilder('card')
        .where('card.taboo_set_id is null OR card.taboo_set_id = 0')
        .getCount();
      if (cardCount === cache.cardCount) {
        headers.append('If-Modified-Since', cache.lastModified);
      }
    }
    try {
      const response = await fetch(uri, {
        method: 'GET',
        headers,
      });
      if (response.status === 304 && cache) {
        return cache;
      }
      VERBOSE && console.log('Got results from ArkhamDB');

      const lastModified = response.headers.get('Last-Modified') || undefined;
      const json = await response.json();
      VERBOSE && console.log('Parsed ArkhamDB json');

      const encounterSets = await db.encounterSets();
      const cards = await db.cards();
      const tabooSets = await db.tabooSets();
      const rules = await db.rules();

      // Delete the tables.
      await cards.createQueryBuilder().delete().execute();
      await encounterSets.createQueryBuilder().delete().execute();
      await tabooSets.createQueryBuilder().delete().execute();
      await rules.createQueryBuilder().delete().execute();
      await db.clearCache();
      VERBOSE && console.log('Cleared old database');

      await syncRules(db, lang);
      // console.log(`${await cards.count() } cards after delete`);
      const genericInvestigator = Card.fromJson({
        pack_code: 'custom',
        pack_name: t`Custom`,
        type_code: 'investigator',
        type_name: t`Investigator`,
        faction_code: 'neutral',
        faction_name: t`Neutral`,
        position: 1,
        code: 'custom_001',
        name: 'Johnny Anybody',
        real_name: 'Johnny Anybody',
        subname: t`The Chameleon`,
        text: t`This is a custom investigator to allow for building of arbitrary decks.\n[elder_sign]: +X where X is whatever you want it to be.`,
        quantity: 1,
        skill_willpower: 3,
        skill_intellect: 3,
        skill_combat: 3,
        skill_agility: 3,
        health: 7,
        health_per_investigator: false,
        sanity: 7,
        deck_limit: 1,
        deck_requirements: {
          size: 30,
          card: {},
          random: [{ target: 'subtype', value: 'basicweakness' }],
        },
        deck_options: [{
          faction: ['guardian','seeker','rogue','mystic','survivor','neutral'],
          level: { min: 0, max: 5 },
        }],
        is_unique: true,
        double_sided: true,
        back_text: '<b>Deck Size</b>: 30.\n<b>Deckbuilding Options</b>: Guardian cards ([guardian]) level 0-5, Seeker cards ([seeker]) level 0-5, Rogue cards ([rogue]) level 0-5, Mystic cards ([mystic]) level 0-5, Survivor cards ([survivor]) level 0-5, Neutral cards level 0-5.\n<b>Deckbuilding Requirements</b> (do not count toward deck size): 1 random basic weakness.',
      }, packsByCode, cycleNames, lang || 'en');
      genericInvestigator.browse_visible = 4;
      const cardsToInsert: Card[] = [genericInvestigator];
      const dupes: {
        [code: string]: string[] | undefined;
      } = {};
      forEach(json, cardJson => {
        try {
          const card = Card.fromJson(cardJson, packsByCode, cycleNames, lang || 'en');
          if (card) {
            if (card.duplicate_of_code) {
              if (!dupes[card.duplicate_of_code]) {
                dupes[card.duplicate_of_code] = [];
              }
              dupes[card.duplicate_of_code]?.push(card.pack_code);
            }
            cardsToInsert.push(card);
          }
        } catch (e) {
          Alert.alert(`${e}`);
          console.log(e);
          console.log(cardJson);
        }
      });
      const linkedSet = new Set(flatMap(cardsToInsert, (c: Card) => c.linked_card ? [c.code, c.linked_card] : []));
      const dedupedCards = filter(cardsToInsert, (c: Card) => !!c.linked_card || !linkedSet.has(c.code));
      const flatCards = flatMap(dedupedCards, (c: Card) => {
        return c.linked_card ? [c, c.linked_card] : [c];
      });
      const encounter_card_counts: {
        [encounter_code: string]: number | undefined;
      } = {};

      // Clean up all the bonded stuff.
      const bondedNames: string[] = [];
      const playerCards: Card[] = [];
      forEach(flatCards, card => {
        if (dupes[card.code]) {
          card.reprint_pack_codes = dupes[card.code];
        }
        if (!card.hidden && card.encounter_code) {
          encounter_card_counts[card.encounter_code] = (encounter_card_counts[card.encounter_code] || 0) + (card.quantity || 1);
        }
        if (card.bonded_name) {
          bondedNames.push(card.bonded_name);
        }
        if ((card.deck_limit && card.deck_limit > 0) && !card.spoiler && !(card.xp === undefined || card.xp === null)) {
          playerCards.push(card);
        }
      });

      // Handle all upgrade stuff
      const cardsByName = values(groupBy(playerCards, card => card.real_name));
      forEach(cardsByName, cardsGroup => {
        if (cardsGroup.length > 1) {
          const maxXpCard = head(sortBy(cardsGroup, card => -(card.xp || 0)));
          if (maxXpCard) {
            forEach(cardsGroup, card => {
              const xp = card.xp || 0;
              card.has_upgrades = xp < (maxXpCard.xp || 0);
            });
          }
        }
      });

      // Handle all bonded card stuff, and encountercode sizes.
      const bondedSet = new Set(bondedNames);
      forEach(flatCards, card => {
        if (card.encounter_code) {
          card.encounter_size = encounter_card_counts[card.encounter_code] || 0;
          encounter_card_counts;
        }
        if (bondedSet.has(card.real_name)) {
          card.bonded_from = true;
        }
      });

      // Deal with duplicate ids?
      forEach(groupBy(flatCards, card => card.id), dupes => {
        if (dupes.length > 1) {
          forEach(dupes, (dupe, idx) => {
            dupe.id = `${dupe.id}_${idx}`;
          });
        }
      });

      const [linkedCards, normalCards] = partition(dedupedCards, card => !!card.linked_card);
      const queryRunner = await db.startTransaction();
      VERBOSE && console.log('Parsed all cards');
      await insertChunk(flatMap(linkedCards, c => c.linked_card ? [c.linked_card] : []), async(c: Card[]) => {
        await queryRunner.manager.insert(Card, c);
      });
      // console.log('Inserted back-link cards');
      await insertChunk(linkedCards, async(c: Card[]) => {
        await queryRunner.manager.insert(Card, c);
      });
      VERBOSE && console.log('Inserted front link cards');
      await insertChunk(normalCards, async(c: Card[]) => {
        await queryRunner.manager.insert(Card, c);
      });
      await queryRunner.commitTransaction();
      await queryRunner.release();
      VERBOSE && console.log('Inserted normal cards');
      const cardCount = await cards.createQueryBuilder('card')
        .where('card.taboo_set_id is null OR card.taboo_set_id = 0')
        .getCount();
      return {
        cardCount,
        lastModified,
      };
    } catch (e) {
      console.log(e);
      return Promise.resolve(null);
    }
  } catch (e) {
    console.log(e);
    throw e;
  }
};

export const getFaqEntry = async function(db: Database, code: string) {
  const faqs = await db.faqEntries();
  const faqEntry = await faqs.createQueryBuilder()
    .where('code = :code')
    .setParameters({ code })
    .getOne();

  const headers = new Headers();
  if (faqEntry && faqEntry.lastModified) {
    headers.append('If-Modified-Since', faqEntry.lastModified);
  }
  const uri = `https://arkhamdb.com/api/public/faq/${code}.json`;
  const response = await fetch(uri, {
    method: 'GET',
    headers: headers,
  });
  if (response.status === 304) {
    return Promise.resolve(true);
  }
  const lastModified = response.headers.get('Last-Modified') || undefined;
  const json = await response.json();
  if (json.length) {
    faqs.save(FaqEntry.fromJson(code, json[0], lastModified));
    return true;
  }
  faqs.save(FaqEntry.empty(code, lastModified));
  return false;
};

export default {
  syncCards,
  syncTaboos,
  getFaqEntry,
};
