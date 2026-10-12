/**
 * The app.
 *
 * Two screens and no router: a library and a player. A navigation library
 * would add a dependency, a focus system to fight, and nothing this needs.
 *
 * A title without a description track still opens. Refusing to play it would
 * make the app less useful than the channel it sits on, and the point is not
 * that undescribed video is unwatchable — it is that a blind viewer cannot
 * follow it.
 */

import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { LibraryScreen } from './LibraryScreen';
import { PlayerScreen } from './PlayerScreen';
import { CATALOGUE, type Title } from './catalogue';
import { Focusable } from './Focusable';
import { colour, space, type } from './theme';

export function App(): React.JSX.Element {
  const [open, setOpen] = useState<Title | null>(null);
  const back = useCallback(() => setOpen(null), []);

  if (!open) {
    return <LibraryScreen titles={CATALOGUE} onOpen={setOpen} />;
  }

  if (!open.description) {
    return <Undescribed title={open} onBack={back} />;
  }

  return (
    <PlayerScreen
      title={open.name}
      videoUrl={open.videoUrl}
      descriptionUrl={open.description.trackUrl}
      manifest={open.description.manifest}
      onBack={back}
    />
  );
}

/**
 * What a blind viewer meets today.
 *
 * Shown rather than hidden: this is the condition the project exists to
 * change, and a demo that only ever shows the good path is arguing with
 * nobody.
 */
function Undescribed({ title, onBack }: { title: Title; onBack: () => void }) {
  return (
    <View style={styles.root}>
      <Text style={styles.name}>{title.name}</Text>
      <Text style={styles.body}>
        This title has no description track. The picture plays, but nothing tells you what is on
        screen during the silences.
      </Text>
      <Text style={styles.aside}>
        Build one with: npx tsx pipeline/cli.ts --title {title.id}
      </Text>
      <Focusable label="Back" autoFocus onPress={onBack} style={styles.back} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colour.ground, padding: space.safe, justifyContent: 'center' },
  name: { color: colour.ink, fontSize: type.display, marginBottom: space.md },
  body: { color: colour.inkMuted, fontSize: type.body, maxWidth: 900, marginBottom: space.md },
  aside: { color: colour.inkMuted, fontSize: type.tiny, marginBottom: space.lg },
  back: { alignSelf: 'flex-start' },
});

export default App;
