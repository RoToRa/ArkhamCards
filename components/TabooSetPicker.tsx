import React from 'react';
import { find, map } from 'lodash';
import Realm, { Results } from 'realm';
import { connectRealm, TabooSetResults } from 'react-native-realm';
import { SettingsPicker } from 'react-native-settings-components';
import { t } from 'ttag';

import Card from '../data/Card';
import TabooSet from '../data/TabooSet';
import { COLORS } from '../styles/colors';

interface OwnProps {
  color: string;
  tabooSetId?: number;
  setTabooSet: (tabooSet?: number) => void;
  disabled?: boolean;
  description?: string;
  open?: boolean;
}

interface RealmProps {
  realm: Realm;
  tabooSets: Results<TabooSet>;
}

type Props = OwnProps & RealmProps;

class TabooSetPicker extends React.Component<Props> {
  tabooPickerRef?: SettingsPicker<number>;

  componentDidUpdate(prevProps: Props) {
    if (this.props.open && !prevProps.open) {
      this.tabooPickerRef && this.tabooPickerRef.openModal();
    }
  }

  _captureTabooPickerRef = (ref: SettingsPicker<number>) => {
    this.tabooPickerRef = ref;
    if (this.props.open && this.tabooPickerRef) {
      this.tabooPickerRef.openModal();
    }
  }

  _onTabooChange = (tabooId: number) => {
    this.tabooPickerRef && this.tabooPickerRef.closeModal();
    this.props.setTabooSet(
      tabooId === -1 ? undefined : tabooId
    );
  };

  _tabooSetToLabel = (tabooId: number) => {
    if (tabooId === -1) {
      return t`None`;
    }
    const { tabooSets } = this.props;
    const tabooSet = find(tabooSets, obj => obj.id === tabooId);
    if (tabooSet) {
      return tabooSet.date_start;
    }
    return t`None`;
  }

  render() {
    const {
      disabled,
      tabooSets,
      tabooSetId,
      color,
      description,
    } = this.props;
    const options = [
      { value: -1, label: t`None` },
      ...map(tabooSets, set => {
        return {
          label: set.date_start,
          value: set.id,
        };
      }),
    ];
    return (
      <SettingsPicker
        ref={this._captureTabooPickerRef}
        title={t`Taboo List`}
        dialogDescription={description}
        value={tabooSetId || -1}
        valuePlaceholder={t`None`}
        valueFormat={this._tabooSetToLabel}
        onValueChange={this._onTabooChange}
        modalStyle={{
          header: {
            wrapper: {
              backgroundColor: color,
            },
            description: {
              paddingTop: 8,
            },
          },
          list: {
            itemColor: color,
          },
        }}
        options={options}
        disabled={disabled}
        disabledOverlayStyle={{
          backgroundColor: 'rgba(255,255,255,0.0)',
        }}
        valueStyle={{
          color: COLORS.darkGray,
        }}
      />
    );
  }
}

export default connectRealm<OwnProps, RealmProps, Card, {}, TabooSet>(
  TabooSetPicker, {
    schemas: ['TabooSet'],
    mapToProps(
      results: TabooSetResults<TabooSet>,
      realm: Realm
    ): RealmProps {
      return {
        realm,
        tabooSets: results.tabooSets,
      };
    },
  });
