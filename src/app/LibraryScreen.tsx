/**
 * The library.
 *
 * Every row says plainly whether a blind viewer can follow that title, and
 * in a real archive catalogue most rows say no. That is not a gap in the
 * demo — it is the argument. A library where everything is already described
 * would be showing a solved problem.
 *
 * The count at the top states it in one line, which is the sentence a
 * channel operator would otherwise have to work out for themselves.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Focusable } from './Focusable';
import { colour, radius, space, type } from './theme';
import { describedCount, type Title } from './catalogue';

export interface LibraryScreenProps {
  titles: Title[];
  onOpen: (title: Title) => void;
}

export function LibraryScreen({ titles, onOpen }: LibraryScreenProps): React.JSX.Element {
  const described = describedCount(titles);
  return (
    <View style={styles.root}>
      <Text style={styles.brand}>The Gap Track</Text>
      <Text style={styles.summary}>
        {described} of {titles.length} titles can be followed without sight.
      </Text>

      <View style={styles.list}>
        {titles.map((t, i) => (
          <Row
            key={t.id}
            title={t}
            autoFocus={i === 0}
            onOpen={onOpen}
          />
        ))}
      </View>

    </View>
  );
}

function Row({
  title,
  autoFocus,
  onOpen,
}: {
  title: Title;
  autoFocus: boolean;
  onOpen: (t: Title) => void;
}) {
  const has = Boolean(title.description);

  return (
    <View style={styles.row}>
      <View style={styles.meta}>
        <Text style={styles.name}>{title.name}</Text>
        <Text style={styles.attribution}>{title.attribution}</Text>

        <View style={[styles.badge, has ? styles.badgeOn : styles.badgeOff]}>
          <Text style={[styles.badgeText, has ? styles.badgeTextOn : styles.badgeTextOff]}>
            {has ? 'AUDIO DESCRIPTION' : 'NO AUDIO DESCRIPTION'}
          </Text>
        </View>

        {title.description ? (
          <Text style={styles.provenance}>{title.description.provenance}</Text>
        ) : (
          // Naming the reason matters. This is not an oversight by the
          // channel; it is what commissioning a describer costs.
          <Text style={styles.provenance}>
            Never commissioned. Human description runs $15–30 per finished minute.
          </Text>
        )}
      </View>

      <Focusable
        label={has ? 'Watch' : 'Watch without description'}
        autoFocus={autoFocus}
        onPress={() => onOpen(title)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colour.ground, paddingHorizontal: space.safe, paddingVertical: space.lg },
  brand: { color: colour.ink, fontSize: type.title, marginBottom: space.xs },
  summary: { color: colour.inkMuted, fontSize: type.body, marginBottom: space.md },
  // Not centred, and clipped. Four rows of 10-foot type are taller than the
  // space left under the header, and centring overflow pushes it out of BOTH
  // ends — which drew the first row straight over the title.
  list: { flex: 1, overflow: 'hidden' },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space.xs,
    borderBottomWidth: 1,
    borderBottomColor: colour.line,
  },
  meta: { flex: 1, paddingRight: space.lg },
  name: { color: colour.ink, fontSize: type.body },
  attribution: { color: colour.inkMuted, fontSize: type.tiny, marginTop: 2 },

  badge: {
    alignSelf: 'flex-start',
    marginTop: space.sm,
    paddingVertical: 3,
    paddingHorizontal: space.xs,
    borderRadius: radius.sm,
  },
  badgeOn: { backgroundColor: colour.accentSoft },
  badgeOff: { backgroundColor: colour.signalSoft },
  badgeText: { fontSize: type.tiny, letterSpacing: 1.5 },
  badgeTextOn: { color: colour.accent },
  badgeTextOff: { color: colour.signal },

  provenance: { color: colour.inkMuted, fontSize: type.tiny, marginTop: space.xs },
});
