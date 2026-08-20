import type { CoachRead, ScoringSystem, Surface } from "@matchpoint/api-client";
import { updateCurrentCoach } from "@matchpoint/api-client";
import {
  getCurrentCoachOptions,
  getCurrentCoachQueryKey,
} from "@matchpoint/api-client/react-query";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { AppPage, PageHeader } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { ItemGroup } from "@/components/ui/item";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SCORING_SYSTEM_LABEL, SURFACE_LABEL } from "@/lib/tennis-labels";

const NONE = "none";

const SURFACE_OPTIONS = Object.entries(SURFACE_LABEL) as [Surface, string][];
const SCORING_SYSTEM_OPTIONS = Object.entries(SCORING_SYSTEM_LABEL) as [ScoringSystem, string][];

/**
 * Match Defaults (#178, #104). Two auto-saving pickers, not a form with a Save
 * button — each row is a standalone preference, the same low-friction feel as a
 * toggle. Not `SegmentedControl`: `ScoringSystem` alone has 8 values, unreadable
 * as a row of segments on a phone (Miller's Law), so both rows use a real `Select`
 * for consistency between them.
 */
export function SettingsMatchDefaults() {
  const queryClient = useQueryClient();
  const { data: coach } = useQuery(getCurrentCoachOptions());

  const { mutate } = useMutation({
    mutationFn: async (body: {
      default_surface?: Surface | null;
      default_scoring_system?: ScoringSystem | null;
    }) => {
      const { data, error } = await updateCurrentCoach({ body });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      // Same cache-write-not-invalidate pattern as EditProfileSheet: the response
      // is already the coach's new record, so there's nothing to refetch.
      queryClient.setQueryData<CoachRead>(getCurrentCoachQueryKey(), data);
    },
  });

  return (
    <AppPage nav={false}>
      <PageHeader
        title="Match Defaults"
        back={
          <Link
            to="/settings"
            aria-label="Back to settings"
            className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
          >
            <ArrowLeft />
          </Link>
        }
      />

      <ItemGroup>
        <Field orientation="horizontal">
          <FieldLabel htmlFor="default-surface">Default surface</FieldLabel>
          <Select
            value={coach?.default_surface ?? NONE}
            onValueChange={(value) =>
              mutate({ default_surface: value === NONE ? null : (value as Surface) })
            }
          >
            <SelectTrigger id="default-surface">
              <SelectValue>
                {(value: string) =>
                  value === NONE ? "No preference" : SURFACE_LABEL[value as Surface]
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>No preference</SelectItem>
              {SURFACE_OPTIONS.map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field orientation="horizontal">
          <FieldLabel htmlFor="default-scoring-system">Default scoring system</FieldLabel>
          <Select
            value={coach?.default_scoring_system ?? NONE}
            onValueChange={(value) =>
              mutate({
                default_scoring_system: value === NONE ? null : (value as ScoringSystem),
              })
            }
          >
            <SelectTrigger id="default-scoring-system">
              <SelectValue>
                {(value: string) =>
                  value === NONE ? "No preference" : SCORING_SYSTEM_LABEL[value as ScoringSystem]
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>No preference</SelectItem>
              {SCORING_SYSTEM_OPTIONS.map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </ItemGroup>
    </AppPage>
  );
}
