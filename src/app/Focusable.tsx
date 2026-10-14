/**
 * A button that can actually be reached with a remote.
 *
 * This exists because of two things the spike cost days to learn:
 *
 *   Nothing is focused by default on Vega. Without seeding focus the D-pad
 *   has no target and every press goes nowhere, which looks exactly like a
 *   dead app rather than a navigation problem.
 *
 *   `FocusManager` wants a native tag, not a component ref, so focus has to
 *   go through `findNodeHandle`. The `Navigable` component the docs describe
 *   does not exist in react-native-kepler 4.0 — that is the 0.72-era API.
 *
 * Focus is also drawn as a border, not a tint: at ten feet a colour shift is
 * invisible, and this app's users are the last people who should have to
 * squint to find the cursor.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable,
  Text,
  View,
  findNodeHandle,
  StyleSheet,
  type ViewStyle,
} from 'react-native';
import { FocusManager } from '@amazon-devices/react-native-kepler';

import { colour, radius, space, type } from './theme';

export interface FocusableProps {
  label: string;
  onPress: () => void;
  /** Seed focus here on mount. Exactly one per screen. */
  autoFocus?: boolean;
  /** Drawn as chosen, independently of focus. */
  selected?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  /** Smaller treatment for dense rows such as the settings list. */
  compact?: boolean;
  /** Reports which control holds focus, for the on-screen diagnostic. */
  onFocusChange?: (label: string) => void;
}

export function Focusable({
  label,
  onPress,
  autoFocus = false,
  selected = false,
  disabled = false,
  style,
  compact = false,
  onFocusChange,
}: FocusableProps): React.JSX.Element {
  const ref = useRef<View | null>(null);
  const [focused, setFocused] = useState(false);
  // Read inside the seeding interval, which closes over the initial state.
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!autoFocus) return undefined;

    // Retry rather than fire once. A single delayed attempt assumes the
    // native view exists by then, and when it does not the seed is silently
    // lost — which presents as an app that renders perfectly and ignores
    // every button press. Keep trying until focus actually lands.
    let attempts = 0;
    const id = setInterval(() => {
      attempts++;
      const tag = ref.current ? findNodeHandle(ref.current) : null;
      if (tag != null) {
        try {
          FocusManager.focus(tag);
        } catch {
          // Keep trying; the view may not be attached yet.
        }
      }
      // Stop once focus is confirmed, or after ~3s rather than forever.
      if (focusedRef.current || attempts > 20) clearInterval(id);
    }, 150);
    return () => clearInterval(id);
  }, [autoFocus]);

  const handle = useCallback(() => {
    if (!disabled) onPress();
  }, [disabled, onPress]);

  return (
    <Pressable
      ref={ref}
      focusable={!disabled}
      disabled={disabled}
      onPress={handle}
      onFocus={() => {
        focusedRef.current = true;
        setFocused(true);
        onFocusChange?.(label);
      }}
      onBlur={() => {
        focusedRef.current = false;
        setFocused(false);
      }}
      style={[
        styles.base,
        compact && styles.compact,
        selected && styles.selected,
        focused && styles.focused,
        disabled && styles.disabled,
        style,
      ]}
    >
      <Text style={[styles.label, compact && styles.labelCompact, focused && styles.labelFocused]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    backgroundColor: colour.surface,
    borderWidth: 3,
    borderColor: 'transparent',
    borderRadius: radius.sm,
  },
  compact: {
    paddingVertical: space.xs,
    paddingHorizontal: space.sm,
  },
  // Chosen but not focused: a quiet left marker, so selection survives when
  // the cursor moves elsewhere.
  selected: {
    backgroundColor: colour.accentSoft,
    borderLeftColor: colour.accent,
  },
  focused: {
    borderColor: colour.accent,
    backgroundColor: colour.accentSoft,
  },
  disabled: { opacity: 0.35 },
  label: { color: colour.ink, fontSize: type.body },
  labelCompact: { fontSize: type.label },
  labelFocused: { color: colour.ink },
});
