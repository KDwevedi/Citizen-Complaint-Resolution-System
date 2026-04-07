import { useGetList } from 'ra-core';
import { DigitCard } from '@/components/digit/DigitCard';
import { useNavigate } from 'react-router-dom';
import { getDedicatedResources, getResourceLabel } from '@/providers/bridge';
import {
  Building2,
  MapPin,
  Users,
  Briefcase,
  Award,
  AlertTriangle,
  Globe,
  MessageSquare,
  User,
  Shield,
} from 'lucide-react';

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  tenants: Building2,
  departments: Briefcase,
  designations: Award,
  'complaint-types': AlertTriangle,
  employees: Users,
  complaints: MessageSquare,
  boundaries: MapPin,
  localization: Globe,
  users: User,
  'access-roles': Shield,
};

function ResourceCard({ resource }: { resource: string }) {
  const { total, isPending } = useGetList(resource, {
    pagination: { page: 1, perPage: 1 },
    sort: { field: 'id', order: 'ASC' },
    filter: {},
  });

  const navigate = useNavigate();
  const label = getResourceLabel(resource);
  const Icon = ICONS[resource] ?? Briefcase;

  return (
    <button
      onClick={() => navigate(`/manage/${resource}`)}
      className="text-left w-full h-full"
    >
      <DigitCard className="h-full flex flex-col mb-0 max-w-none min-h-[120px]">
        {/* Label + small icon — top left */}
        <div className="flex items-center gap-1.5">
          <Icon className="w-4 h-4 text-primary shrink-0" />
          <p className="text-sm font-medium text-muted-foreground leading-tight">{label}</p>
        </div>
        {/* Number — centered in remaining space */}
        <div className="flex-1 flex items-center justify-center mt-2">
          <p className="text-4xl font-bold text-foreground tabular-nums">
            {isPending ? '—' : (total ?? 0)}
          </p>
        </div>
      </DigitCard>
    </button>
  );
}

export function DigitDashboard() {
  const dedicatedMap = getDedicatedResources();
  const resources = Object.keys(dedicatedMap).filter(
    (r) => ICONS[r] // only show resources that have icons
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl sm:text-3xl font-bold font-condensed text-foreground">
        DIGIT Management Studio
      </h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 items-stretch">
        {resources.map((resource) => (
          <ResourceCard key={resource} resource={resource} />
        ))}
      </div>
    </div>
  );
}
