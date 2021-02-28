import React from 'react';

import { WeaknessSet, InvestigatorData, CampaignId } from '@actions/types';
import CampaignStateHelper from '@data/scenario/CampaignStateHelper';
import CampaignGuide from '@data/scenario/CampaignGuide';
import { LatestDecks } from '@data/scenario';
import Card, { CardsMap } from '@data/types/Card';

export interface CampaignGuideContextType {
  campaignId: CampaignId;
  campaignGuideVersion: number;
  campaignName: string;
  campaignGuide: CampaignGuide;
  campaignState: CampaignStateHelper;
  campaignInvestigators: Card[];
  weaknessSet: WeaknessSet;
  latestDecks: LatestDecks;
  adjustedInvestigatorData: InvestigatorData;
  playerCards: CardsMap;
  lastUpdated: Date;
}

export const CampaignGuideContext = React.createContext<CampaignGuideContextType>(
  // @ts-ignore TS2345
  { }
);

export default CampaignGuideContext;
