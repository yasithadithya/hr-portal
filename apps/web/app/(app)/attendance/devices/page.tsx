'use client';

import { Trash2 } from 'lucide-react';
import { useState } from 'react';

import { AttendanceTabs } from '@/components/attendance/attendance-ui';
import { RequirePermission } from '@/components/auth/require-permission';
import { ErrorAlert } from '@/components/common/error-alert';
import { PageHeader } from '@/components/common/page-header';
import { FormField, selectClass } from '@/components/employees/fields';
import { ImportWizard } from '@/components/imports/import-wizard';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useEmployeeOptions } from '@/lib/queries/admin';
import { useDeleteDeviceUser, useDeviceUsers, useSaveDeviceUser } from '@/lib/queries/attendance';

function DeviceUsers() {
  const list = useDeviceUsers();
  const people = useEmployeeOptions();
  const save = useSaveDeviceUser();
  const del = useDeleteDeviceUser();
  const [deviceUserId, setDeviceUserId] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Map one device user</CardTitle>
          <CardDescription>
            The id a person is enrolled with on the fingerprint machine (often called AC-No or User
            ID). If ids match your employee numbers, you can skip mapping.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(
                { deviceUserId, employeeId },
                {
                  onSuccess: () => {
                    setDeviceUserId('');
                    setEmployeeId('');
                  },
                },
              );
            }}
          >
            <FormField id="du-id" label="Device user id">
              <Input
                id="du-id"
                className="w-36"
                required
                value={deviceUserId}
                onChange={(e) => setDeviceUserId(e.target.value)}
              />
            </FormField>
            <FormField id="du-emp" label="Employee">
              <select
                id="du-emp"
                required
                className={`${selectClass} w-64`}
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
              >
                <option value="">Choose…</option>
                {people.data?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.employeeNo} · {p.name}
                  </option>
                ))}
              </select>
            </FormField>
            <Button type="submit" disabled={save.isPending}>
              Save
            </Button>
          </form>
        </CardContent>
      </Card>
      {list.error && <ErrorAlert error={list.error} />}
      {list.data && list.data.length > 0 && (
        <div className="rounded-md border">
          {list.data.map((d) => (
            <div
              key={d.id}
              className="flex items-center gap-3 border-b px-4 py-2 text-sm last:border-0"
            >
              <span className="w-24 font-mono">{d.deviceUserId}</span>
              <span className="flex-1">
                {d.employeeName} <span className="text-muted-foreground">({d.employeeNo})</span>
              </span>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Remove mapping ${d.deviceUserId}`}
                onClick={() => del.mutate(d.id)}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
      <div>
        <h3 className="mb-2 font-medium">Import many mappings</h3>
        <ImportWizard kind="attendance-device-users" />
      </div>
    </div>
  );
}

export default function DevicesPage() {
  return (
    <RequirePermission permission="attendance.manage" scope="all">
      <PageHeader
        title="Attendance"
        description="Import punches exported from fingerprint machines (CSV or Excel)"
      />
      <AttendanceTabs />
      <Tabs defaultValue="punches">
        <TabsList>
          <TabsTrigger value="punches">Import punches</TabsTrigger>
          <TabsTrigger value="users">Device users</TabsTrigger>
        </TabsList>
        <TabsContent value="punches" className="space-y-3 pt-4">
          <p className="text-muted-foreground text-sm">
            One row per punch. Dates may be YYYY-MM-DD or DD/MM/YYYY; times are office time.
            Importing the same file twice adds nothing. Locked months are refused.
          </p>
          <ImportWizard kind="attendance-punches" />
        </TabsContent>
        <TabsContent value="users" className="pt-4">
          <DeviceUsers />
        </TabsContent>
      </Tabs>
    </RequirePermission>
  );
}
