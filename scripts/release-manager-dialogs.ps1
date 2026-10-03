# Developer-only dialogs. All work uses the same guarded asynchronous worker.
function Style-ManagerDialog($dialog) {
    $dialog.BackColor=$form.BackColor;$dialog.ForeColor=$form.ForeColor;$dialog.Font=$form.Font
    $queue=New-Object 'System.Collections.Generic.Queue[System.Windows.Forms.Control]'
    foreach($control in $dialog.Controls){$queue.Enqueue($control)}
    while($queue.Count){$control=$queue.Dequeue();foreach($childControl in $control.Controls){$queue.Enqueue($childControl)}
        if($control -is [Windows.Forms.TextBox]){$control.BackColor=[Drawing.Color]::FromArgb(11,17,25);$control.ForeColor=$form.ForeColor}
        if($control -is [Windows.Forms.Button]){$control.FlatStyle='Flat';$control.BackColor=[Drawing.Color]::FromArgb(37,51,70);$control.ForeColor=$form.ForeColor}
    }
}
function Show-Review($title,$text,$approve,$details,[switch]$TestOnly){
 $dialog=New-Object Windows.Forms.Form;$dialog.Text=$title;$dialog.Size=New-Object Drawing.Size(650,570);$dialog.MinimumSize=New-Object Drawing.Size(580,480);$dialog.StartPosition='CenterParent';$dialog.AutoScaleMode='Dpi'
 $table=New-Object Windows.Forms.TableLayoutPanel;$table.Dock='Fill';$table.Padding=New-Object Windows.Forms.Padding(20);$table.ColumnCount=1;$table.RowCount=3
 $table.RowStyles.Add((New-Object Windows.Forms.RowStyle([Windows.Forms.SizeType]::Percent,100)))|Out-Null
 foreach($height in @(42,54)){$table.RowStyles.Add((New-Object Windows.Forms.RowStyle([Windows.Forms.SizeType]::Absolute,$height)))|Out-Null};$dialog.Controls.Add($table)
 $body=New-Object Windows.Forms.TextBox;$body.Multiline=$true;$body.ReadOnly=$true;$body.ScrollBars='Vertical';$body.Dock='Fill';$body.Text=$text;$body.BorderStyle='None';$table.Controls.Add($body,0,0)
 $toggle=New-Object Windows.Forms.Button;$toggle.Text='Advanced Details';$toggle.Dock='Left';$toggle.Width=175;$table.Controls.Add($toggle,0,1)
 $toggle.Tag=$false;$toggle.Add_Click({$this.Tag=-not $this.Tag;$body.Text=if($this.Tag){$text+"`r`n`r`nADVANCED DETAILS`r`n"+$details}else{$text};$this.Text=if($this.Tag){'Hide Advanced Details'}else{'Advanced Details'}})
 $buttons=New-Object Windows.Forms.FlowLayoutPanel;$buttons.Dock='Fill';$buttons.FlowDirection='RightToLeft';$table.Controls.Add($buttons,0,2)
 $cancel=New-Object Windows.Forms.Button;$cancel.Text=if($approve){'Cancel'}else{'Close'};$cancel.Size=New-Object Drawing.Size(115,40);$cancel.DialogResult='Cancel';$buttons.Controls.Add($cancel);$dialog.CancelButton=$cancel
 if($approve){$ok=New-Object Windows.Forms.Button;$ok.Text=$approve;$ok.AutoSize=$true;$ok.MinimumSize=New-Object Drawing.Size(190,40);$ok.DialogResult='OK';$buttons.Controls.Add($ok)}
 Style-ManagerDialog $dialog;$body.BackColor=$form.BackColor;$body.ForeColor=$form.ForeColor;$body.Font=$form.Font
 if($TestOnly){
  $script:reviewFailure=$null
  $dialog.Add_Shown({
    try{
      if($toggle.Tag -or $body.Text.Contains('SHA-256:')){throw 'Technical information leaked into normal review'}
      $toggle.PerformClick();if(-not $body.Text.Contains('ADVANCED DETAILS')){throw 'Advanced details missing'}
      $toggle.PerformClick();if($body.Text -ne $text){throw 'Advanced details did not close'}
    }catch{$script:reviewFailure='Review dialog safety/visibility test failed'}finally{$dialog.Close()}
  })
  $dialog.ShowDialog($form)|Out-Null;$dialog.Dispose();if($script:reviewFailure){throw $script:reviewFailure};return $false
 }
 $answer=$dialog.ShowDialog($form);$dialog.Dispose();return $answer -eq 'OK'
}
function Confirm-Publish($summary,[switch]$TestOnly){
 $text="Rovarin $($summary.version)`r`n`r`nLatest project changes checked`r`nPrivate/local files excluded`r`nInstaller built and verified`r`nTests passed`r`nGitHub connected`r`n`r`nThis WILL update your project on GitHub, create a downloadable version and make it visible to other people.`r`n`r`nInstaller: RovarinSetup.exe`r`nStatus: Verified`r`n`r`nCancel keeps the prepared local version and installer. Nothing is uploaded."
 $details=$summary|ConvertTo-Json -Depth 6
 return Show-Review 'Ready to Publish' $text ('Publish Version '+$summary.version) $details -TestOnly:$TestOnly
}
function Show-Preview($plan,[switch]$TestOnly){
 $text="Nothing will be changed.`r`n`r`nCurrent version: $($plan.currentVersion)`r`nPatch: $($script:statusResult.patchVersion) - small fixes and improvements`r`nMinor: $($script:statusResult.minorVersion) - larger updates or new features`r`n`r`nChanges since the previous version: $(@($plan.meaningfulChanges).Count) files`r`nInstaller: will be rebuilt`r`nTests: will run before publishing`r`nGitHub: $(if($script:statusResult.github -eq 'Authenticated'){'Connected'}else{'Check connection before publishing'})`r`n`r`nWhen you publish, we check the project, exclude private files, build and test the installer, save the exact project version, upload it to GitHub and create a download page.`r`n`r`nNothing has been changed yet."
 return Show-Review 'Preview New Release' $text 'Continue to Publish' ($plan|ConvertTo-Json -Depth 6) -TestOnly:$TestOnly
}
function Show-FriendlyError($technical){
 if($technical -match '^[A-Za-z .]+ update could not be verified\.'){
  Show-Review 'Tool update needs attention' (($technical -split ' Technical Details:',2)[0]) '' $technical|Out-Null;return
 }
 if($technical -match '^Update details changed'){
  Show-Review 'Check Again' 'The installation or update information changed, or the update service could not be checked. No update was started. Check Again before continuing.' '' $technical|Out-Null;return
 }
 $text=if($technical -match 'Nothing new to publish'){$technical}elseif($technical -match '^(.+?) (could not be updated|update could not be verified)'){$Matches[1]+" could not be updated or verified. No other tool update was requested. A partial update may remain.`r`n`r`nCheck for updates again before retrying. Advanced Details has the reason."}elseif($technical -match 'already.*(?:tag|Release)|already.*exist'){ 'That version number is already in use. Choose a different version. No new version was published.' }elseif($technical -match 'signed out|sign-in|authentication'){ 'GitHub sign-in needs attention. Open Updates & Tools and sign in again before uploading or publishing.' }elseif($technical -match 'failed|timed out'){ 'This request could not be completed. Check your connection and required software, then try again. Local preparation may remain; see Advanced Details.' }else{'This request stopped safely. Review Advanced Details for the reason before trying again.'}
 Show-Review 'Request needs attention' $text '' $technical|Out-Null
}
function Show-Tools($value,[switch]$TestOnly,[switch]$InteractiveSmoke) {
    $dialog=New-Object Windows.Forms.Form; $dialog.Text='Updates & Tools'; $dialog.Size=New-Object Drawing.Size(780,690); $dialog.StartPosition='CenterParent';$dialog.MinimumSize=$dialog.Size
    $summary=New-Object Windows.Forms.Label;$summary.Location=New-Object Drawing.Point(18,16);$summary.Size=New-Object Drawing.Size(485,60);$dialog.Controls.Add($summary);$script:toolSummary=$summary
    $all=New-Object Windows.Forms.Button;$all.Text='Update All';$all.Location=New-Object Drawing.Point(555,20);$all.Size=New-Object Drawing.Size(185,40);$dialog.Controls.Add($all);$script:toolAllButton=$all
    $body=New-Object Windows.Forms.TextBox;$body.Multiline=$true;$body.ReadOnly=$true;$body.ScrollBars='Vertical';$body.Location=New-Object Drawing.Point(18,82);$body.Size=New-Object Drawing.Size(725,371);$body.Visible=$false;$dialog.Controls.Add($body)
    $list=New-Object Windows.Forms.FlowLayoutPanel;$list.Location=$body.Location;$list.Size=$body.Size;$list.FlowDirection='TopDown';$list.WrapContents=$false;$list.AutoScroll=$true;$dialog.Controls.Add($list);$script:toolList=$list
    $script:toolsValue=$value;$script:toolDetailsOpen=$false
    $script:toolCheckButton=$null
    $script:toolsBody=$body; $script:toolsRenderCount=0
    function Render-Tools($result){
        $script:toolsValue=$result
        $safe=@($result.tools|Where-Object canUpdate)
        $attention=@($result.sections|Where-Object title -eq 'Needs Attention').items.Count
        $script:toolSummary.Text="GitHub: $(if($result.account -eq 'Sign-in required'){'Sign-in required'}else{'Connected as '+$result.account})`r`n$(if(-not $safe.Count -and -not $attention){'Everything checked is up to date.'}else{"$($safe.Count) updates available$(if($attention){' - some tools need attention'})."})"
        if($script:toolCheckButton){$script:toolCheckButton.Text='Check Again'}
        if(@($result.tools|Where-Object update -eq 'Not checked').Count){$script:toolSummary.Text="GitHub: $($result.account)`r`nUpdates not checked yet. Use Check for Updates."}
        if(-not $result.sections){$script:toolSummary.Text="GitHub: $($result.account)`r`nTool status could not be refreshed. Check Again."}
        $script:toolAllButton.Enabled=$safe.Count -gt 0 -and -not $script:worker
        $script:toolList.SuspendLayout()
        while($script:toolList.Controls.Count){$old=$script:toolList.Controls[0];$script:toolList.Controls.Remove($old);$old.Dispose()}
        $script:toolUpdateButtons=@();$text=''
        foreach($section in $result.sections){
            $heading=New-Object Windows.Forms.Label;$heading.Text=$section.title;$heading.Size=New-Object Drawing.Size(680,30);$heading.Font=New-Object Drawing.Font('Segoe UI',11,[Drawing.FontStyle]::Bold);$heading.ForeColor=$dialog.ForeColor;$script:toolList.Controls.Add($heading)
            $text+="$($section.title)`r`n"
            if(-not $section.items.Count){$empty=New-Object Windows.Forms.Label;$empty.Text=if($section.title -eq 'Updates Available'){'No verified updates available. Check for Updates to refresh.'}else{'None currently.'};$empty.Size=New-Object Drawing.Size(680,28);$empty.ForeColor=$dialog.ForeColor;$script:toolList.Controls.Add($empty)}
            foreach($item in $section.items){
                $row=New-Object Windows.Forms.Panel;$row.Size=New-Object Drawing.Size(680,$(if($section.title -eq 'System Tools'){52}else{68}))
                $label=New-Object Windows.Forms.Label;$label.Text="$($item.name)$(if($section.title -ne 'Updates Available'){'  '+$item.version})`r`n$($item.explanation)";$label.Location=New-Object Drawing.Point(4,4);$label.Size=New-Object Drawing.Size(475,62);$label.ForeColor=$dialog.ForeColor;$row.Controls.Add($label)
                $action=New-Object Windows.Forms.Button;$action.Text=if($section.title -eq 'Updates Available'){'Update '+$item.name}else{'Details'};$action.Location=New-Object Drawing.Point(490,8);$action.Size=New-Object Drawing.Size(180,38);$action.Tag=$item.name
                $action.Add_Click({if(-not $script:worker){$script:toolSelector.SelectedItem=$this.Tag;$script:toolActionButton.PerformClick()}})
                $row.Controls.Add($action);$script:toolList.Controls.Add($row);$script:toolUpdateButtons+=,$action
                $text+="$($item.name): $($item.explanation)`r`n"
            }
            $text+="`r`n"
        }
        $script:toolList.ResumeLayout()
        $script:toolBusyControls=@($script:toolCheckButton,$script:toolSelector,$script:toolActionButton,$script:toolSignIn,$script:toolAllButton)+$script:toolUpdateButtons
        $text+="MANAGED BY Rovarin`r`nRovarin manages its bundled runtime and build components automatically. You normally do not need to update them here. See Advanced Details.`r`n"
        $script:toolsNormal=$text;$script:toolsTechnical=($result|ConvertTo-Json -Depth 6)+"`r`n`r`nAdvanced Build Components: managed by Rovarin. You normally do not need to touch them."
        $script:toolsBody.Text=if($script:toolDetailsOpen){$text+$script:toolsTechnical}else{$text}
        $selected=$script:toolSelector.SelectedItem
        $script:toolSelector.Items.Clear()
        foreach($item in $result.tools){$script:toolSelector.Items.Add($item.name)|Out-Null}
        if($selected -and $script:toolSelector.Items.Contains($selected)){$script:toolSelector.SelectedItem=$selected}elseif($script:toolSelector.Items.Count){$script:toolSelector.SelectedIndex=0}
        if($script:toolSignIn){$script:toolSignIn.Enabled=$result.account -eq 'Sign-in required'}
        $script:toolsRenderCount++
    }
    $check=New-Object Windows.Forms.Button;$check.Text='Check for Updates';$check.Location=New-Object Drawing.Point(18,468);$check.Size=New-Object Drawing.Size(330,38);$dialog.Controls.Add($check)
    $script:toolCheckButton=$check
    $check.Add_Click({if(-not $script:worker){Start-Request @{mode='ToolUpdates'} ${function:Render-Tools}}})
    $selector=New-Object Windows.Forms.ComboBox;$selector.DropDownStyle='DropDownList';$selector.Location=New-Object Drawing.Point(18,518);$selector.Size=New-Object Drawing.Size(230,38);$dialog.Controls.Add($selector);$script:toolSelector=$selector
    $toolAction=New-Object Windows.Forms.Button;$toolAction.Text='Tool details';$toolAction.Location=New-Object Drawing.Point(260,518);$toolAction.Size=New-Object Drawing.Size(205,38);$dialog.Controls.Add($toolAction)
    $script:toolActionButton=$toolAction
    $selector.Add_SelectedIndexChanged({$item=$script:toolsValue.tools|Where-Object name -eq $script:toolSelector.SelectedItem;$toolAction.Text=if($item.canUpdate){'Update '+$item.name}elseif($item.multiple){'Show Installations'}elseif($item.update -in @('Unable to check','Unable to determine')){'Try Again'}else{'Why? / Details'}})
    $toolAction.Add_Click({
        if($script:worker){return}
        $item=$script:toolsValue.tools|Where-Object name -eq $script:toolSelector.SelectedItem
        if(-not $item){return}
        if($item.update -in @('Unable to check','Unable to determine')){Start-Request @{mode='ToolUpdates'} ${function:Render-Tools};return}
        $explanation=($script:toolsValue.sections.items|Where-Object id -eq $item.id).explanation
        $text="$($item.name)`r`n`r`nInstalled: $(if($item.installed){'Yes'}else{'No'})`r`nVersion: $($item.version)`r`n$explanation`r`nUsed for: $(if($item.use){$item.use}else{'Build and publish Rovarin'})`r`n"
        if($item.canUpdate){
            $text+="`r`nNew version: $($item.available)`r`nRelease Manager verified how this copy was installed and will update that same installation. Your settings will not intentionally be removed. Close active sessions of this tool first."
            $approved=Show-Review ('Update '+$item.name+'?') $text ('Update '+$item.name) ($item|ConvertTo-Json -Depth 6) -TestOnly:$UiSmoke
            if($approved){Start-Request @{mode='UpdateTool';tool=$item.id;current=$item.packageVersion;available=$item.available;snapshot=$item.snapshot;confirm=$true} {param($result) Render-Tools $result;Show-Review 'Tool updated' $result.message '' ''|Out-Null}}
        }else{
            $text+="`r`nAutomatic update is not available right now. Check for updates first. If the installation method is unknown, use the original installer."
            if($item.method -eq 'Rokit'){$text+="`r`nRokit manages Rojo. Update it through Rokit in your Roblox project."}
            if($item.instructions){$text+="`r`n`r`nOfficial update instructions:`r`n$($item.instructions)"}
            Show-Review ($item.name+' — Update Instructions') $text '' ($item|ConvertTo-Json -Depth 6) -TestOnly:$UiSmoke|Out-Null
        }
    })
    $signin=New-Object Windows.Forms.Button;$signin.Text='Sign in to GitHub';$signin.Location=New-Object Drawing.Point(478,518);$signin.Size=New-Object Drawing.Size(180,38);$dialog.Controls.Add($signin)
    $signin.Add_Click({try{
        $gh=Join-Path $env:ProgramFiles 'GitHub CLI\gh.exe';if(-not(Test-Path -LiteralPath $gh)){$gh=(Get-Command gh.exe -ErrorAction Stop).Source}
        Start-Process -FilePath $gh -ArgumentList @('auth','login','--hostname','github.com','--git-protocol','https')
        [Windows.Forms.MessageBox]::Show('Complete the GitHub sign-in window, then check Developer Tools again. No credentials are stored by Release Manager.','GitHub sign-in') | Out-Null
    }catch{[Windows.Forms.MessageBox]::Show($_.Exception.Message,'GitHub sign-in could not start') | Out-Null}})
    $details=New-Object Windows.Forms.Button;$details.Text='Advanced Details';$details.Location=New-Object Drawing.Point(18,580);$details.Size=New-Object Drawing.Size(190,38);$dialog.Controls.Add($details)
    $details.Add_Click({$script:toolDetailsOpen=-not $script:toolDetailsOpen;$script:toolsBody.Text=$script:toolsNormal+$script:toolsTechnical;$script:toolsBody.Visible=$script:toolDetailsOpen;$script:toolList.Visible=-not $script:toolDetailsOpen;$this.Text=if($script:toolDetailsOpen){'Hide Advanced Details'}else{'Advanced Details'}})
    $close=New-Object Windows.Forms.Button;$close.Text='Close';$close.Location=New-Object Drawing.Point(645,580);$close.DialogResult='Cancel';$dialog.Controls.Add($close);$dialog.CancelButton=$close
    $script:toolUpdateButtons=@();$script:toolSignIn=$signin
    $script:toolBusyControls=@($check,$selector,$toolAction,$signin,$all)
    $all.Add_Click({
        if($script:worker){return}
        $candidates=@($script:toolsValue.tools|Where-Object canUpdate|ForEach-Object {@{tool=$_.id;current=$_.packageVersion;available=$_.available;snapshot=$_.snapshot}})
        if(-not $candidates.Count){return}
        $names=($script:toolsValue.tools|Where-Object canUpdate|ForEach-Object {"$($_.name): $($_.version) -> $($_.available)"}) -join "`r`n"
        $approved=Show-Review 'Update these tools?' ("$names`r`n`r`nOnly these verified installations will be updated, one at a time. Settings are not intentionally removed. Changed installations will be skipped. Failed updates will not be retried. Close active sessions of these tools first.") 'Update All' ($candidates|ConvertTo-Json -Depth 6) -TestOnly:$UiSmoke
        if($approved){Start-Request @{mode='UpdateTools';candidates=$candidates;confirm=$true} {param($result)
            Render-Tools $result
            $rows=($result.results|ForEach-Object {"$($_.name): $($_.result)`r`n$($_.message)"}) -join "`r`n`r`n"
            Show-Review 'Tool update results' ($result.message+"`r`n`r`n"+$rows) '' ''|Out-Null
        }}
    })
    Style-ManagerDialog $dialog
    Render-Tools $value
    if($TestOnly){if($body.Text -match 'pawnIoVersion|innoVersion|PROJECT-MANAGED' -or $selector.Items.Count -ne $value.tools.Count){throw 'Developer tools UI safety failed'};$dialog.Dispose();return}
    $dialog.Add_FormClosing({param($s,$e) if($script:worker){$e.Cancel=$true}})
    $smokeTimer=$null
    if($InteractiveSmoke){
        $script:toolsSmokeOpen=$true
        $smokeTimer=New-Object Windows.Forms.Timer;$smokeTimer.Interval=250
        $script:toolCheckClicked=$false
        $smokeTimer.Add_Tick({
            if(-not $script:toolCheckClicked){$script:toolCheckClicked=$true;$check.PerformClick();return}
            if($script:toolsRenderCount -ge 2 -and -not $script:worker){
                if(-not [ReleaseWorker]::IsWindowVisible($dialog.Handle)){throw 'Developer tools dialog hidden'}
                $codingItem=$script:toolsValue.tools|Where-Object group -eq 'coding'|Select-Object -First 1
                if($codingItem){$selector.SelectedItem=$codingItem.name;$toolAction.PerformClick()}
                $all.PerformClick()
                $script:toolList.AutoScrollPosition=New-Object Drawing.Point(0,0)
                $bitmap=New-Object Drawing.Bitmap($dialog.Width,$dialog.Height);$dialog.DrawToBitmap($bitmap,(New-Object Drawing.Rectangle(0,0,$dialog.Width,$dialog.Height)));$bitmap.Save((Join-Path $root 'packaging/cache/release-manager-tools-ui.png'));$bitmap.Dispose()
                $smokeTimer.Stop();$dialog.Close()
            }
        });$smokeTimer.Start()
    }
    try{$dialog.ShowDialog($form) | Out-Null}finally{if($smokeTimer){$smokeTimer.Stop();$smokeTimer.Dispose()};$script:toolsSmokeOpen=$false;$dialog.Dispose()}
}
